import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    Alert,
    DeviceEventEmitter,
    NativeSyntheticEvent,
    NativeScrollEvent,
    Keyboard,
    TextInputContentSizeChangeEventData,
    ActivityIndicator,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import {
    SendIcon,
    RefreshCwIcon,
    PaperclipIcon,
} from 'lucide-react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePantry } from '../contexts/pantryContext';
import { useAuth } from '../contexts/authContext';
import AppHeader from '../components/AppHeader';
import { ChatMessageRow } from '../components/chat/ChatMessageRow';
import ChatEmptyState from '../components/chat/ChatEmptyState';
import { chatApi, ChatResponseData, ChatResponseType, HistoryMessage, HistoryPendingInterrupt, PendingToolSummary } from '../api/chat';
import { classifyResumeFailure, isExpiredApproval } from '../utils/chatResume';
import { mealPlanApi } from '../api/mealPlan';
import { unitConversionsApi } from '../api/unitConversions';
import type { DefineUnitAction } from '../components/chat/ChatMessageRow';
import { colors } from '../theme/tokens';
import { SkeletonList } from '../components/ui/Skeleton';
import { DRAW_DISTANCE } from '../constants/listPerf';
import { pickPantryImage } from '../utils/pantryImagePick';
import { pantryVisionApi } from '../api/pantryVision';

/** ChatGPT / Claude-style composer: one-line resting height, grows with content. */
const INPUT_LINE_HEIGHT = 22;
const INPUT_MIN_HEIGHT = 22;
const INPUT_MAX_HEIGHT = 100;
/** Streamed tokens are flushed to state at most this often. */
const TOKEN_FLUSH_MS = 50;

type ChatScreenParams = {
  Chat?: {
    initialPrompt?: string;
    sessionId?: string;
    newChat?: boolean;
  };
};

interface ResponseCardData {
    recipeId?: string;
    recipeName?: string;
    ingredientCount?: number;
    steps?: string[];
    sourceUrl?: string;
    itemsAdded?: number;
    items?: Array<{ name: string; quantity?: string | number; unit?: string }>;
    mealPlanId?: string;
    mealType?: string;
    servingDate?: string;
    mealsScheduled?: number;
    meals?: Array<{ meal_name?: string; serving_date?: string; meal_type?: string }>;
    mergedGroups?: number;
    removedDuplicates?: number;
    suggestions?: Array<{ recipeId?: string; recipeName?: string; matchScore?: number }>;
    actionCount?: number;
    actions?: Array<Record<string, unknown>>;
    message?: string;
}

type PendingApproval = {
    sessionId: string;
    pendingTools: PendingToolSummary[];
    interruptId?: string;
};

function readInterruptId(data: Record<string, unknown> | undefined): string | undefined {
    const raw = data?.interruptId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function pendingFrom(
    sessionId: string,
    tools: PendingToolSummary[],
    interruptId?: string,
): PendingApproval {
    const id = interruptId?.trim();
    return {
        sessionId,
        pendingTools: tools,
        ...(id ? { interruptId: id } : {}),
    };
}

function pendingFromHistory(
    sessionId: string,
    pending: HistoryPendingInterrupt,
): PendingApproval {
    return pendingFrom(sessionId, pending.pendingTools, pending.interruptId);
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    type?: ChatResponseType;
    cardData?: ResponseCardData;
    timestamp: number;
    streaming?: boolean;
    statusText?: string;
}

export default function AICookingAssistantScreen() {
    const { t, i18n } = useTranslation();
    const navigation = useNavigation();
    const route = useRoute<RouteProp<ChatScreenParams, 'Chat'>>();
    const insets = useSafeAreaInsets();
    const {
        fetchAllRecipes,
        fetchAllShoppingListItems,
        fetchAllPantryItems,
        fetchAllMealPlans,
    } = usePantry();
    const { isGuest } = useAuth();
    const flatListRef = useRef<FlashListRef<Message>>(null);
    const nearBottomRef = useRef(true);
    const resumeInFlightRef = useRef(false);
    const [historyReady, setHistoryReady] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const loadSeqRef = useRef(0);
    const loadTargetRef = useRef<string | undefined>(undefined);
    const loadErrorRef = useRef(false);
    const mountedRef = useRef(true);
    const abortRef = useRef<AbortController | null>(null);
    const tokenBufferRef = useRef('');
    const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [keyboardVisible, setKeyboardVisible] = useState(false);

    const [input, setInput] = useState('');
    const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [addingToMenuRecipeId, setAddingToMenuRecipeId] = useState<string | null>(null);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
    const [headerHeight, setHeaderHeight] = useState(88);
    const [recognizing, setRecognizing] = useState(false);
    const [composerFocused, setComposerFocused] = useState(false);

    const isTypingRef = useRef(false);
    const pendingApprovalRef = useRef(pendingApproval);
    pendingApprovalRef.current = pendingApproval;

    const canSend = input.trim().length > 0 && !isTyping && !pendingApproval && !loadError;

    // Cancel the in-flight stream and timers when the screen unmounts.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
            if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
        };
    }, []);

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const show = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
        const hide = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);
    const isEmptyChat = messages.length === 0;

    const suggestedPrompts = useMemo(() => {
        const prompts = t('ai.suggestedPrompts', { returnObjects: true });
        return Array.isArray(prompts) ? (prompts as string[]) : [];
    }, [t, i18n.language]);

    useEffect(() => {
        const prompt = route.params?.initialPrompt;
        if (!prompt) return;
        setInput(prompt);
        navigation.setParams({ initialPrompt: undefined } as never);
    }, [route.params?.initialPrompt, navigation]);

    const handleInputContentSizeChange = (
        event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
    ) => {
        const next = Math.min(
            INPUT_MAX_HEIGHT,
            Math.max(INPUT_MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height)),
        );
        setInputHeight(next);
    };

    const isMultilineInput = inputHeight > INPUT_LINE_HEIGHT + 4;

    const handleAttachPantryImage = useCallback(async () => {
        if (recognizing || isTyping) return;
        const picked = await pickPantryImage(t);
        if (!picked) return;
        setRecognizing(true);
        try {
            const res = await pantryVisionApi.recognize(picked.uri);
            if (!res.success || !res.data) {
                Alert.alert(
                    t('pantryVision.errorTitle'),
                    res.message || t('pantryVision.errorRecognize'),
                );
                return;
            }
            navigation.navigate({
                name: 'PantryImageReview',
                params: {
                    items: res.data.items ?? [],
                    imageUri: picked.uri,
                    source: 'chat',
                    emptyMessage: res.data.message || undefined,
                },
            } as never);
        } catch {
            Alert.alert(
                t('pantryVision.errorTitle'),
                t('pantryVision.errorRecognize'),
            );
        } finally {
            setRecognizing(false);
        }
    }, [recognizing, isTyping, t, navigation]);

    const applyHistory = useCallback(
        (data: NonNullable<Awaited<ReturnType<typeof chatApi.getHistory>>['data']>, sid: string | null) => {
            const mapped: Message[] = data.messages?.length
                ? data.messages.map((entry: HistoryMessage) => ({
                      id: entry.id,
                      role: entry.role,
                      content: entry.content,
                      type: entry.responseType as ChatResponseType | undefined,
                      cardData: entry.cardData as ResponseCardData | undefined,
                      timestamp: entry.createdAt * 1000,
                  }))
                : [];
            const pending = data.pendingInterrupt;
            const hasPending = Boolean(sid && pending?.pendingTools?.length);
            setMessages(
                hasPending && !mapped.some((m) => m.type === 'interrupt')
                    ? [
                          ...mapped,
                          {
                              id: `interrupt-restored-${Date.now()}`,
                              role: 'assistant',
                              content: t('ai.approvalRestored'),
                              timestamp: Date.now(),
                              type: 'interrupt' as ChatResponseType,
                          },
                      ]
                    : mapped,
            );
            if (hasPending && sid && pending) {
                setPendingApproval(pendingFromHistory(sid, pending));
            } else {
                setPendingApproval(null);
            }
        },
        [t],
    );

    /**
     * Load a conversation. With no target: bootstrap (sessions list, then that session's history). Failures show an error state with Retry instead of an empty chat.
     */
    const loadConversation = useCallback(
        async (target?: string) => {
            const seq = ++loadSeqRef.current;
            loadTargetRef.current = target;
            loadErrorRef.current = false;
            setLoadError(false);
            setHistoryReady(false);
            try {
                let sid: string | null = target ?? null;
                let response: Awaited<ReturnType<typeof chatApi.getHistory>>;
                if (target) {
                    response = await chatApi.getHistory(target);
                } else {
                    // The history endpoint requires a sessionId, so the list must come first.
                    const sessionsRes = await chatApi.listSessions();
                    if (seq !== loadSeqRef.current) return;
                    if (!sessionsRes.success) {
                        loadErrorRef.current = true;
                        setLoadError(true);
                        setMessages([]);
                        setPendingApproval(null);
                        return;
                    }
                    const list = sessionsRes.data?.sessions ?? [];
                    const initialId = list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? null;
                    if (!initialId) {
                        // Brand-new user (e.g. a fresh guest): no conversation yet, show the empty chat.
                        setActiveSessionId(null);
                        setMessages([]);
                        setPendingApproval(null);
                        return;
                    }
                    sid = initialId;
                    response = await chatApi.getHistory(initialId);
                }
                if (seq !== loadSeqRef.current) return;
                if (!response.success || !response.data) {
                    loadErrorRef.current = true;
                    setLoadError(true);
                    setMessages([]);
                    setPendingApproval(null);
                    return;
                }
                sid = response.data.sessionId ?? sid;
                setActiveSessionId(sid);
                applyHistory(response.data, sid);
            } catch (error) {
                console.error('Failed to load chat history', error);
                if (seq === loadSeqRef.current) {
                    loadErrorRef.current = true;
                    setLoadError(true);
                    setMessages([]);
                    setPendingApproval(null);
                }
            } finally {
                if (seq === loadSeqRef.current) setHistoryReady(true);
            }
        },
        [applyHistory],
    );

    const handleRetryLoad = useCallback(() => {
        void loadConversation(loadTargetRef.current);
    }, [loadConversation]);

    useEffect(() => {
        void loadConversation();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
    }, []);

    const handleNewSession = useCallback(async () => {
        try {
            const created = await chatApi.createSession();
            if (created.success && created.data) {
                // A new chat supersedes any in-flight/failed load.
                loadSeqRef.current += 1;
                loadErrorRef.current = false;
                setLoadError(false);
                setHistoryReady(true);
                setActiveSessionId(created.data.id);
                setPendingApproval(null);
                setMessages([]);
            } else {
                Alert.alert(t('common.error'), created.message || t('ai.networkError'));
            }
        } catch (error) {
            console.error(error);
            Alert.alert(t('common.error'), t('ai.networkError'));
        }
    }, [t]);

    const handleSwitchSession = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId || isTypingRef.current) return;
        setActiveSessionId(sessionId);
        await loadConversation(sessionId);
    }, [activeSessionId, loadConversation]);

    useEffect(() => {
        const { sessionId, newChat } = route.params ?? {};
        if (newChat) {
            navigation.setParams({ newChat: undefined, sessionId: undefined } as never);
            void handleNewSession();
            return;
        }
        if (sessionId) {
            navigation.setParams({ sessionId: undefined } as never);
            void handleSwitchSession(sessionId);
        }
    }, [route.params?.sessionId, route.params?.newChat, handleNewSession, handleSwitchSession, navigation]);

    const cardTypes: ChatResponseType[] = [
        'recipe_created', 'recipe_imported', 'recipe_updated',
        'shopping_list_updated', 'meal_plan_updated', 'pantry_updated',
        'meal_suggestions', 'multi_action', 'action_result',
    ];

    const mapResponseToMessage = (aiData: ChatResponseData): Message => ({
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: aiData.message,
        type: aiData.type,
        cardData: cardTypes.includes(aiData.type)
            ? (aiData.data as ResponseCardData | undefined)
            : undefined,
        timestamp: Date.now(),
    });

    const refreshAfterAgentAction = async (type: ChatResponseType) => {
        const tasks: Promise<unknown>[] = [];
        if (['recipe_created', 'recipe_imported', 'recipe_updated', 'meal_suggestions', 'multi_action', 'action_result'].includes(type)) {
            tasks.push(fetchAllRecipes());
        }
        if (['meal_plan_updated', 'meal_suggestions', 'multi_action', 'action_result'].includes(type)) {
            tasks.push(fetchAllMealPlans());
        }
        if (['pantry_updated', 'meal_suggestions', 'multi_action', 'action_result'].includes(type)) {
            tasks.push(fetchAllPantryItems());
        }
        if (['shopping_list_updated', 'meal_plan_updated', 'multi_action', 'action_result'].includes(type)) {
            tasks.push(fetchAllShoppingListItems());
        }
        await Promise.all(tasks);
    };

    const sendChatMessage = async (
        userMessageContent: string,
        opts?: { hidden?: boolean },
    ) => {
        if (
            !userMessageContent.trim() ||
            isTypingRef.current ||
            pendingApprovalRef.current ||
            loadErrorRef.current
        ) {
            return;
        }

        const hidden = Boolean(opts?.hidden);
        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: userMessageContent,
            timestamp: Date.now(),
        };
        const assistantId = `assistant-${Date.now()}`;
        const streamingMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            streaming: true,
            statusText: t('ai.thinking'),
        };

        setMessages((prev) =>
            hidden ? [...prev, streamingMessage] : [...prev, userMessage, streamingMessage],
        );
        if (!hidden) {
            setInput('');
            setInputHeight(INPUT_MIN_HEIGHT);
        }
        isTypingRef.current = true;
        setIsTyping(true);
        nearBottomRef.current = true;
        requestAnimationFrame(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
        });

        // Cancel any previous stream; the new one owns the abort controller until it ends.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Tokens arrive far faster than we want to re-render: buffer and flush on a timer.
        tokenBufferRef.current = '';
        const discardTokens = () => {
            if (tokenTimerRef.current) {
                clearTimeout(tokenTimerRef.current);
                tokenTimerRef.current = null;
            }
            tokenBufferRef.current = '';
        };
        const flushTokens = () => {
            if (tokenTimerRef.current) {
                clearTimeout(tokenTimerRef.current);
                tokenTimerRef.current = null;
            }
            const chunk = tokenBufferRef.current;
            if (!chunk || !mountedRef.current) return;
            tokenBufferRef.current = '';
            setMessages((prev) => {
                let idx = prev.length - 1;
                if (idx < 0 || prev[idx].id !== assistantId) {
                    idx = prev.findIndex((message) => message.id === assistantId);
                }
                if (idx < 0) return prev;
                const next = prev.slice();
                next[idx] = {
                    ...prev[idx],
                    content: prev[idx].content + chunk,
                    statusText: undefined,
                };
                return next;
            });
        };

        let settled = false;
        const settleStreaming = (updater: (message: Message) => Message) => {
            settled = true;
            // Final content replaces whatever was streamed; drop any unflushed tokens.
            discardTokens();
            if (!mountedRef.current) return;
            setMessages((prev) =>
                prev.map((message) => (message.id === assistantId ? updater(message) : message)),
            );
        };

        try {
            await chatApi.streamSend(
                {
                    message: userMessageContent,
                    sessionId: activeSessionId ?? undefined,
                },
                {
                    onToken: (token) => {
                        tokenBufferRef.current += token;
                        if (!tokenTimerRef.current) {
                            tokenTimerRef.current = setTimeout(flushTokens, TOKEN_FLUSH_MS);
                        }
                    },
                    onStatus: (status) => {
                        setMessages((prev) =>
                            prev.map((message) =>
                                message.id === assistantId
                                    ? { ...message, statusText: status.message }
                                    : message,
                            ),
                        );
                    },
                    onInterrupt: (response) => {
                        const tools =
                            (response.data?.pendingTools as PendingToolSummary[] | undefined) ?? [];
                        const sessionId =
                            (response.data?.sessionId as string | undefined) ??
                            activeSessionId ??
                            '';
                        setPendingApproval(
                            pendingFrom(sessionId, tools, readInterruptId(response.data)),
                        );
                        settleStreaming((message) => ({
                            ...message,
                            type: 'interrupt',
                            content: response.message || t('ai.approvalRequired'),
                            streaming: false,
                            statusText: undefined,
                        }));
                    },
                    onDone: async (response) => {
                        if (response.type === 'interrupt') {
                            if (settled) return;
                            const tools =
                                (response.data?.pendingTools as PendingToolSummary[] | undefined) ??
                                [];
                            const sessionId =
                                (response.data?.sessionId as string | undefined) ??
                                activeSessionId ??
                                '';
                            setPendingApproval(
                                pendingFrom(sessionId, tools, readInterruptId(response.data)),
                            );
                            settleStreaming((message) => ({
                                ...message,
                                type: 'interrupt',
                                content: response.message || t('ai.approvalRequired'),
                                streaming: false,
                                statusText: undefined,
                            }));
                            return;
                        }
                        const finalized = mapResponseToMessage(response);
                        settleStreaming((message) => ({
                            ...finalized,
                            id: assistantId,
                            timestamp: message.timestamp,
                            streaming: false,
                            statusText: undefined,
                        }));
                        if (
                            finalized.type &&
                            finalized.type !== 'text' &&
                            finalized.type !== 'error'
                        ) {
                            await refreshAfterAgentAction(finalized.type);
                        }
                    },
                    onError: (message) => {
                        const text = message || t('ai.noResponse');
                        if (
                            isGuest &&
                            /signup_required|sign up to save/i.test(text)
                        ) {
                            Alert.alert(t('auth.signupRequired'), undefined, [
                                { text: t('common.cancel'), style: 'cancel' },
                                {
                                    text: t('auth.guestBannerCta'),
                                    onPress: () =>
                                        navigation.navigate('SaveKitchen' as never),
                                },
                            ]);
                        }
                        settleStreaming((entry) => ({
                            ...entry,
                            type: 'error',
                            content: text,
                            streaming: false,
                            statusText: undefined,
                        }));
                    },
                    onSessionTitle: ({ sessionId, title }) => {
                        DeviceEventEmitter.emit('lardermind:chat-session-title', {
                            sessionId,
                            title,
                        });
                    },
                },
                controller.signal,
            );
        } catch (error) {
            // Aborted (screen unmounted or superseded by a new send): nothing to show.
            if (!controller.signal.aborted) {
                console.error(error);
                if (!settled) {
                    settleStreaming((message) => ({
                        ...message,
                        type: 'error',
                        content: t('ai.networkError'),
                        streaming: false,
                        statusText: undefined,
                    }));
                }
            }
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
            if (!settled) {
                // Keep whatever text already streamed, then stop the caret.
                flushTokens();
                discardTokens();
            }
            if (mountedRef.current && abortRef.current === null) {
                isTypingRef.current = false;
                setIsTyping(false);
                if (!settled) {
                    setMessages((prev) =>
                        prev.map((message) =>
                            message.id === assistantId
                                ? { ...message, streaming: false }
                                : message,
                        ),
                    );
                }
            }
        }
    };

    const handleSend = async () => {
        if (!canSend) return;
        await sendChatMessage(input.trim());
    };

    // Stable identity (refs for volatile state) so memoized message rows are not re-rendered.
    const latestRef = useRef({ sendChatMessage, refreshAfterAgentAction, mapResponseToMessage });
    latestRef.current = { sendChatMessage, refreshAfterAgentAction, mapResponseToMessage };

    const handleDefineUnit = useCallback(
        async (action: DefineUnitAction, ratio: number) => {
            if (!(ratio > 0) || isTypingRef.current || pendingApprovalRef.current) return;
            const saved = await unitConversionsApi.upsert({
                itemName: action.item,
                baseUnit: action.from_unit,
                targetUnit: action.to_unit,
                ratio,
            });
            if (!saved) {
                Alert.alert(t('settings.savePrefsError'));
                return;
            }
            const context = `[context] User defined unit conversion: 1 ${action.from_unit} ${action.item} = ${ratio} ${action.to_unit}. Re-run suggestMealsFromPantry and update cookability.`;
            await latestRef.current.sendChatMessage(context, { hidden: true });
        },
        [t],
    );

    const handleResume = useCallback(
        async (decision: 'approve' | 'reject', sessionIdOverride?: string) => {
            // A second tap while the first resume is in flight must not send twice.
            if (resumeInFlightRef.current) return;
            const pending = pendingApprovalRef.current;
            const sessionId = sessionIdOverride ?? pending?.sessionId;
            if (!sessionId) return;
            const interruptId = pending?.sessionId === sessionId ? pending.interruptId : undefined;
            resumeInFlightRef.current = true;
            isTypingRef.current = true;
            setIsTyping(true);

            const pushNote = (content: string) => {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `ai-note-${Date.now()}`,
                        role: 'assistant',
                        content,
                        type: 'text',
                        timestamp: Date.now(),
                    },
                ]);
            };

            try {
                const response = await chatApi.resume({
                    sessionId,
                    decision,
                    ...(interruptId ? { interruptId } : {}),
                });
                if (!mountedRef.current) return;

                if (!response.success || !response.data) {
                    const failure = classifyResumeFailure(response.code, response.statusCode);
                    // Unclassified failures (network, 5xx, timeout): keep the card so the
                    // user can retry, and show the server/network message when there is one.
                    const message = failure.code
                        ? t(failure.messageKey)
                        : response.message || t(failure.messageKey);
                    if (failure.action === 'keep') {
                        Alert.alert(t(failure.titleKey), message);
                        return;
                    }
                    if (failure.action === 'reload') {
                        pushNote(message);
                        Alert.alert(t(failure.titleKey), message);
                        try {
                            const history = await chatApi.getHistory(sessionId);
                            const latest = history.data?.pendingInterrupt;
                            if (!mountedRef.current) return;
                            if (history.success && latest?.pendingTools?.length) {
                                setPendingApproval(pendingFromHistory(sessionId, latest));
                            } else {
                                setPendingApproval(null);
                            }
                        } catch (error) {
                            console.error(error);
                        }
                        return;
                    }
                    setPendingApproval(null);
                    pushNote(message);
                    Alert.alert(t(failure.titleKey), message);
                    return;
                }

                if (isExpiredApproval(response.data)) {
                    setPendingApproval(null);
                    pushNote(response.data.message || t('ai.approvalExpired'));
                    return;
                }

                if (response.data.type === 'interrupt') {
                    const tools =
                        (response.data.data?.pendingTools as PendingToolSummary[] | undefined) ?? [];
                    setPendingApproval(
                        pendingFrom(sessionId, tools, readInterruptId(response.data.data)),
                    );
                } else {
                    setPendingApproval(null);
                }
                const assistantMessage = latestRef.current.mapResponseToMessage(response.data);
                setMessages((prev) => [...prev, assistantMessage]);
                if (
                    assistantMessage.type &&
                    assistantMessage.type !== 'text' &&
                    assistantMessage.type !== 'error' &&
                    assistantMessage.type !== 'interrupt'
                ) {
                    await latestRef.current.refreshAfterAgentAction(assistantMessage.type);
                }
            } catch (error) {
                console.error(error);
                Alert.alert(t('ai.approvalErrorTitle'), t('ai.approvalError'));
            } finally {
                resumeInFlightRef.current = false;
                isTypingRef.current = false;
                if (mountedRef.current) setIsTyping(false);
            }
        },
        [t],
    );

    const handleAddCreatedRecipeToMenu = useCallback(async (recipeId: string) => {
        setAddingToMenuRecipeId(recipeId);
        try {
            const servingDate = new Date().toISOString().slice(0, 10);
            const response = await mealPlanApi.create({
                recipe_id: recipeId,
                meal_type: 'dinner',
                serving_date: servingDate,
            });
            if (!response.success) {
                throw new Error(response.message || "Failed to add recipe to today's dinner");
            }
            await Promise.all([fetchAllMealPlans(), fetchAllRecipes()]);
            Alert.alert(
                "Added to today's dinner",
                `On the calendar for ${servingDate}. Also filed under Dinner.`
            );
        } catch (error) {
            console.error(error);
            Alert.alert('Error', "Could not add recipe to today's dinner.");
        } finally {
            setAddingToMenuRecipeId(null);
        }
    }, [fetchAllMealPlans, fetchAllRecipes]);

    const handleViewCreatedRecipe = useCallback(async (recipeId: string) => {
        await fetchAllRecipes();
        (navigation as { navigate: (name: string, params?: object) => void }).navigate('Recipes', {
            recipeId,
        });
    }, [fetchAllRecipes, navigation]);

    const handleViewShoppingList = useCallback(async () => {
        await fetchAllShoppingListItems();
        (navigation as { navigate: (name: string) => void }).navigate('Shopping');
    }, [fetchAllShoppingListItems, navigation]);

    const handleViewCalendar = useCallback(async () => {
        await fetchAllMealPlans();
        (navigation as { navigate: (name: string) => void }).navigate('Calendar');
    }, [fetchAllMealPlans, navigation]);

    const handleViewPantry = useCallback(async () => {
        await fetchAllPantryItems();
        (navigation as { navigate: (name: string) => void }).navigate('Inventory');
    }, [fetchAllPantryItems, navigation]);

    const handleClearChat = async () => {
        try {
            await chatApi.clearHistory(activeSessionId ?? undefined);
        } catch (error) {
            console.error('Failed to clear chat history', error);
        }
        setPendingApproval(null);
        setMessages([]);
    };

    const approvalProp = useMemo(
        () => (pendingApproval ? { pendingTools: pendingApproval.pendingTools } : null),
        [pendingApproval],
    );
    const handleApprove = useCallback(() => {
        void handleResume('approve');
    }, [handleResume]);
    const handleReject = useCallback(() => {
        void handleResume('reject');
    }, [handleResume]);

    const renderMessage = useCallback(({ item }: { item: Message }) => (
        <ChatMessageRow
            item={item}
            addingToMenuRecipeId={addingToMenuRecipeId}
            onViewCreatedRecipe={handleViewCreatedRecipe}
            onAddCreatedRecipeToMenu={handleAddCreatedRecipeToMenu}
            onViewShoppingList={handleViewShoppingList}
            onViewCalendar={handleViewCalendar}
            onViewPantry={handleViewPantry}
            pendingApproval={item.type === 'interrupt' ? approvalProp : null}
            approvalBusy={item.type === 'interrupt' && isTyping}
            onApprove={handleApprove}
            onReject={handleReject}
            onDefineUnit={handleDefineUnit}
            defineUnitBusy={item.type === 'meal_suggestions' && isTyping}
        />
    ), [
        addingToMenuRecipeId,
        handleViewCreatedRecipe,
        handleAddCreatedRecipeToMenu,
        handleViewShoppingList,
        handleViewCalendar,
        handleViewPantry,
        approvalProp,
        isTyping,
        handleApprove,
        handleReject,
        handleDefineUnit,
    ]);

    const keyExtractor = useCallback((item: Message) => item.id, []);
    const getItemType = useCallback(
        (item: Message) =>
            `${item.role}:${item.type ?? 'text'}:${item.streaming ? 'stream' : 'done'}`,
        [],
    );
    const handleListScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distanceFromBottom =
                contentSize.height - layoutMeasurement.height - contentOffset.y;
            nearBottomRef.current = distanceFromBottom < 140;
        },
        [],
    );
    const handleListContentSizeChange = useCallback(() => {
        if (nearBottomRef.current) {
            // Animated scrolling per streamed chunk fights itself; only animate when idle.
            flatListRef.current?.scrollToEnd({ animated: !isTypingRef.current });
        }
    }, []);

    return (
        <View className="flex-1 bg-linen">
            <AppHeader
                title={t('ai.title')}
                showMenuButton
                rightElement={<RefreshCwIcon size={20} color={colors.ink} />}
                onRightPress={() => {
                    Alert.alert(t('ai.title'), undefined, [
                        { text: t('ai.newChat'), onPress: () => void handleNewSession() },
                        { text: t('ai.clearChat'), onPress: () => void handleClearChat() },
                        { text: t('common.cancel'), style: 'cancel' },
                    ]);
                }}
                onLayoutHeight={setHeaderHeight}
            />

            {isGuest ? (
                <TouchableOpacity
                    onPress={() => navigation.navigate('SaveKitchen' as never)}
                    className="mx-4 mt-2 mb-1 rounded-lg border border-herb/30 bg-sage/50 px-3 py-2"
                    activeOpacity={0.85}
                >
                    <Text className="text-xs text-ink text-center">
                        {t('auth.guestBanner')}{' '}
                        <Text className="font-semibold text-herb">
                            {t('auth.guestBannerCta')}
                        </Text>
                    </Text>
                </TouchableOpacity>
            ) : null}

            <KeyboardAvoidingView
                behavior="padding"
                className="flex-1"
                keyboardVerticalOffset={headerHeight}
            >
                {!historyReady ? (
                    <View className="flex-1 px-4 pt-4">
                        <SkeletonList count={4} />
                    </View>
                ) : loadError ? (
                    <View className="flex-1 items-center justify-center px-8" testID="chat-load-error">
                        <Text className="text-ink text-base text-center mb-4">
                            {t('ai.loadError')}
                        </Text>
                        <TouchableOpacity
                            onPress={handleRetryLoad}
                            accessibilityRole="button"
                            className="bg-herb px-6 py-3 rounded-lg"
                            testID="chat-load-retry"
                        >
                            <Text className="text-white font-medium">{t('common.retry')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : isEmptyChat ? (
                    <ChatEmptyState
                        suggestedPrompts={suggestedPrompts}
                        onSelectPrompt={setInput}
                    />
                ) : (
                    <FlashList
                        ref={flatListRef}
                        data={messages}
                        renderItem={renderMessage}
                        keyExtractor={keyExtractor}
                        getItemType={getItemType}
                        drawDistance={DRAW_DISTANCE}
                        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
                        onScroll={handleListScroll}
                        scrollEventThrottle={16}
                        onContentSizeChange={handleListContentSizeChange}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="interactive"
                    />
                )}

                <View
                    className="bg-linen px-3 pt-2"
                    style={{
                        // The keyboard already covers the home-indicator inset when it is open.
                        paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 12),
                    }}
                >
                    {/* Elevated surface field on linen — clear figure-ground */}
                    <View
                        className={`flex-row rounded-[22px] border bg-surface px-1 py-1 ${
                            isMultilineInput ? 'items-end' : 'items-center'
                        }`}
                        style={{
                            borderColor: composerFocused ? colors.herb : colors.line,
                            borderWidth: 1.5,
                            shadowColor: colors.ink,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.08,
                            shadowRadius: 8,
                            elevation: 2,
                            minHeight: 48,
                        }}
                    >
                        <TouchableOpacity
                            onPress={() => {
                                void handleAttachPantryImage();
                            }}
                            disabled={recognizing || isTyping}
                            accessibilityRole="button"
                            accessibilityLabel={t('pantryVision.attach')}
                            activeOpacity={0.7}
                            className="h-10 w-10 rounded-full items-center justify-center"
                            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                        >
                            {recognizing ? (
                                <ActivityIndicator color={colors.herb} />
                            ) : (
                                <PaperclipIcon size={20} color={colors.muted} />
                            )}
                        </TouchableOpacity>
                        {/* Not locked with editable={!isTyping}: toggling editable dismisses the iOS keyboard. */}
                        <TextInput
                            className="flex-1 text-ink mx-1"
                            style={{
                                fontSize: 16,
                                lineHeight: INPUT_LINE_HEIGHT,
                                height: inputHeight,
                                maxHeight: INPUT_MAX_HEIGHT,
                                paddingTop: 0,
                                paddingBottom: 0,
                                margin: 0,
                                ...(Platform.OS === 'android' ? { textAlignVertical: 'center' } : null),
                            }}
                            value={input}
                            onChangeText={setInput}
                            onContentSizeChange={handleInputContentSizeChange}
                            onFocus={() => setComposerFocused(true)}
                            onBlur={() => setComposerFocused(false)}
                            multiline
                            scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
                            blurOnSubmit={false}
                            returnKeyType="default"
                            accessibilityLabel={t('ai.title')}
                        />
                        <TouchableOpacity
                            onPress={handleSend}
                            disabled={!canSend}
                            accessibilityRole="button"
                            accessibilityLabel={t('ai.send')}
                            activeOpacity={0.7}
                            className={`h-10 w-10 rounded-full items-center justify-center ${
                                canSend ? 'bg-herb' : 'bg-transparent'
                            }`}
                            hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                        >
                            <SendIcon
                                size={18}
                                color={canSend ? colors.onHerb : colors.muted}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}
