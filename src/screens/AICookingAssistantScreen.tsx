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
import AppHeader from '../components/AppHeader';
import { ChatMessageRow } from '../components/chat/ChatMessageRow';
import ChatEmptyState from '../components/chat/ChatEmptyState';
import { chatApi, ChatResponseData, ChatResponseType, HistoryMessage, HistoryPendingInterrupt, PendingToolSummary } from '../api/chat';
import { classifyResumeFailure, isExpiredApproval } from '../utils/chatResume';
import { mealPlanApi } from '../api/mealPlan';
import { colors } from '../theme/tokens';
import { SkeletonList } from '../components/ui/Skeleton';
import { DRAW_DISTANCE } from '../constants/listPerf';
import { pickPantryImage } from '../utils/pantryImagePick';
import { pantryVisionApi } from '../api/pantryVision';

/** ChatGPT / Claude-style composer: one-line resting height, grows with content. */
const INPUT_LINE_HEIGHT = 22;
const INPUT_MIN_HEIGHT = 22;
const INPUT_MAX_HEIGHT = 100;

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
    const flatListRef = useRef<FlashListRef<Message>>(null);
    const nearBottomRef = useRef(true);
    const resumeInFlightRef = useRef(false);
    const [historyReady, setHistoryReady] = useState(false);

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

    const canSend = input.trim().length > 0 && !isTyping && !pendingApproval;
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

    useEffect(() => {
        const bootstrap = async () => {
            try {
                const sessionsRes = await chatApi.listSessions();
                const list = sessionsRes.data?.sessions ?? [];
                const initialId =
                    list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? null;
                setActiveSessionId(initialId);
                const response = await chatApi.getHistory(initialId ?? undefined);
                if (response.success && response.data) {
                    const sid = response.data.sessionId ?? initialId;
                    setActiveSessionId(sid);
                    const mapped: Message[] = response.data.messages?.length
                        ? response.data.messages.map((entry: HistoryMessage) => ({
                              id: entry.id,
                              role: entry.role,
                              content: entry.content,
                              type: entry.responseType as ChatResponseType | undefined,
                              cardData: entry.cardData as ResponseCardData | undefined,
                              timestamp: entry.createdAt * 1000,
                          }))
                        : [];
                    const pending = response.data.pendingInterrupt;
                    const hasPending = Boolean(sid && pending?.pendingTools?.length);
                    setMessages(
                        hasPending && !mapped.some((m) => m.type === 'interrupt')
                            ? [
                                  ...mapped,
                                  {
                                      id: `interrupt-restored-${Date.now()}`,
                                      role: 'assistant',
                                      content:
                                          'I need your approval before making these changes.',
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
                } else {
                    setMessages([]);
                    setPendingApproval(null);
                }
            } catch (error) {
                console.error('Failed to load chat history', error);
                setMessages([]);
            } finally {
                setHistoryReady(true);
            }
        };

        void bootstrap();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
    }, []);

    const handleNewSession = useCallback(async () => {
        try {
            const created = await chatApi.createSession();
            if (created.success && created.data) {
                setActiveSessionId(created.data.id);
                setPendingApproval(null);
                setMessages([]);
            }
        } catch (error) {
            console.error(error);
        }
    }, []);

    const handleSwitchSession = useCallback(async (sessionId: string) => {
        if (sessionId === activeSessionId || isTyping) return;
        setActiveSessionId(sessionId);
        try {
            const response = await chatApi.getHistory(sessionId);
            if (response.success && response.data) {
                const mapped: Message[] = response.data.messages?.length
                    ? response.data.messages.map((entry: HistoryMessage) => ({
                          id: entry.id,
                          role: entry.role,
                          content: entry.content,
                          type: entry.responseType as ChatResponseType | undefined,
                          cardData: entry.cardData as ResponseCardData | undefined,
                          timestamp: entry.createdAt * 1000,
                      }))
                    : [];
                const pending = response.data.pendingInterrupt;
                const hasPending = Boolean(pending?.pendingTools?.length);
                setMessages(
                    hasPending && !mapped.some((m) => m.type === 'interrupt')
                        ? [
                              ...mapped,
                              {
                                  id: `interrupt-restored-${Date.now()}`,
                                  role: 'assistant',
                                  content:
                                      'I need your approval before making these changes.',
                                  timestamp: Date.now(),
                                  type: 'interrupt' as ChatResponseType,
                              },
                          ]
                        : mapped,
                );
                if (hasPending && pending) {
                    setPendingApproval(pendingFromHistory(sessionId, pending));
                } else {
                    setPendingApproval(null);
                }
            } else {
                setMessages([]);
                setPendingApproval(null);
            }
        } catch (error) {
            console.error(error);
            setMessages([]);
            setPendingApproval(null);
        }
    }, [activeSessionId, isTyping]);

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

    const handleSend = async () => {
        if (!input.trim() || isTyping || pendingApproval) return;

        const userMessageContent = input.trim();
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
            statusText: 'Thinking…',
        };

        setMessages((prev) => [...prev, userMessage, streamingMessage]);
        setInput('');
        setInputHeight(INPUT_MIN_HEIGHT);
        setIsTyping(true);
        nearBottomRef.current = true;
        requestAnimationFrame(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
        });

        let settled = false;
        const settleStreaming = (updater: (message: Message) => Message) => {
            settled = true;
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
                        setMessages((prev) =>
                            prev.map((message) =>
                                message.id === assistantId
                                    ? {
                                          ...message,
                                          content: message.content + token,
                                          statusText: undefined,
                                      }
                                    : message,
                            ),
                        );
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
                            content:
                                response.message || 'Approval required before applying changes.',
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
                                content:
                                    response.message ||
                                    'Approval required before applying changes.',
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
                        settleStreaming((entry) => ({
                            ...entry,
                            type: 'error',
                            content:
                                message ||
                                "Sorry, I couldn't get a response. Please try again.",
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
            );
        } catch (error) {
            console.error(error);
            if (!settled) {
                settleStreaming((message) => ({
                    ...message,
                    type: 'error',
                    content: 'Network error. Please check your connection.',
                    streaming: false,
                    statusText: undefined,
                }));
            }
        } finally {
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
    };

    const handleResume = async (
        decision: 'approve' | 'reject',
        sessionIdOverride?: string,
    ) => {
        if (resumeInFlightRef.current) return;
        const sessionId = sessionIdOverride ?? pendingApproval?.sessionId;
        const interruptId = pendingApproval?.interruptId;
        if (!sessionId) return;
        resumeInFlightRef.current = true;
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

            if (!response.success || !response.data) {
                const failure = classifyResumeFailure(response.code, response.statusCode);
                const message = t(failure.messageKey);
                if (failure.action === 'keep') {
                    Alert.alert(t(failure.titleKey), message);
                    return;
                }
                if (failure.action === 'reload') {
                    pushNote(message);
                    Alert.alert(t(failure.titleKey), message);
                    try {
                        const history = await chatApi.getHistory(sessionId);
                        const pending = history.data?.pendingInterrupt;
                        if (history.success && pending?.pendingTools?.length) {
                            setPendingApproval(pendingFromHistory(sessionId, pending));
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

            const assistantMessage = mapResponseToMessage(response.data);
            setMessages((prev) => [...prev, assistantMessage]);
            if (
                assistantMessage.type &&
                assistantMessage.type !== 'text' &&
                assistantMessage.type !== 'error' &&
                assistantMessage.type !== 'interrupt'
            ) {
                await refreshAfterAgentAction(assistantMessage.type);
            }
        } catch (error) {
            console.error(error);
            Alert.alert(t('ai.approvalErrorTitle'), t('ai.approvalError'));
        } finally {
            resumeInFlightRef.current = false;
            setIsTyping(false);
        }
    };

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

    const renderMessage = useCallback(({ item }: { item: Message }) => (
        <ChatMessageRow
            item={item}
            addingToMenuRecipeId={addingToMenuRecipeId}
            onViewCreatedRecipe={handleViewCreatedRecipe}
            onAddCreatedRecipeToMenu={handleAddCreatedRecipeToMenu}
            onViewShoppingList={handleViewShoppingList}
            onViewCalendar={handleViewCalendar}
            onViewPantry={handleViewPantry}
            pendingApproval={
                item.type === 'interrupt' && pendingApproval
                    ? { pendingTools: pendingApproval.pendingTools }
                    : null
            }
            approvalBusy={isTyping}
            onApprove={() => void handleResume('approve')}
            onReject={() => void handleResume('reject')}
        />
    ), [
        addingToMenuRecipeId,
        handleViewCreatedRecipe,
        handleAddCreatedRecipeToMenu,
        handleViewShoppingList,
        handleViewCalendar,
        handleViewPantry,
        pendingApproval,
        isTyping,
        handleResume,
    ]);

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

            <KeyboardAvoidingView
                behavior="padding"
                className="flex-1"
                keyboardVerticalOffset={headerHeight}
            >
                {!historyReady ? (
                    <View className="flex-1 px-4 pt-4">
                        <SkeletonList count={4} />
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
                        keyExtractor={(item) => item.id}
                        getItemType={(item) =>
                            `${item.role}:${item.type ?? 'text'}:${item.streaming ? 'stream' : 'done'}`
                        }
                        drawDistance={DRAW_DISTANCE}
                        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
                        onScroll={(e) => {
                            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
                            const distanceFromBottom =
                                contentSize.height - layoutMeasurement.height - contentOffset.y;
                            nearBottomRef.current = distanceFromBottom < 140;
                        }}
                        scrollEventThrottle={16}
                        onContentSizeChange={() => {
                            if (nearBottomRef.current) {
                                flatListRef.current?.scrollToEnd({ animated: true });
                            }
                        }}
                        keyboardShouldPersistTaps="handled"
                    />
                )}

                <View
                    className="bg-linen px-3 pt-2"
                    style={{ paddingBottom: Math.max(insets.bottom, 12) }}
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
                        >
                            {recognizing ? (
                                <ActivityIndicator color={colors.herb} />
                            ) : (
                                <PaperclipIcon size={20} color={colors.muted} />
                            )}
                        </TouchableOpacity>
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
                            editable={!isTyping}
                            returnKeyType="default"
                            accessibilityLabel={t('ai.title')}
                        />
                        <TouchableOpacity
                            onPress={handleSend}
                            disabled={!canSend}
                            accessibilityRole="button"
                            accessibilityLabel="Send message"
                            activeOpacity={0.7}
                            className={`h-10 w-10 rounded-full items-center justify-center ${
                                canSend ? 'bg-herb' : 'bg-transparent'
                            }`}
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
