import React, { memo, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  TextInput,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import ChatMessageContent from '../ChatMessageContent';
import type { ChatResponseType } from '../../api/chat';
import { colors } from '../../theme/tokens';

export type DefineUnitAction = {
  action_required: 'define_unit';
  item: string;
  from_unit: string;
  to_unit: string;
};

export type ChatCardData = {
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
  suggestions?: Array<{
    recipeId?: string;
    recipeName?: string;
    matchScore?: number;
    cookStatus?: string;
    /** Legacy backend field; prefer recipeName */
    meal_name?: string;
  }>;
  actionCount?: number;
  actions?: Array<Record<string, unknown> | DefineUnitAction>;
  message?: string;
};

export type ChatMessageItem = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: ChatResponseType;
  cardData?: ChatCardData;
  timestamp: number;
  streaming?: boolean;
  statusText?: string;
};

type PendingToolSummary = {
  name: string;
  argsSummary: string;
  id?: string;
};

type ChatMessageRowProps = {
  item: ChatMessageItem;
  addingToMenuRecipeId: string | null;
  onViewCreatedRecipe: (recipeId: string) => void;
  onAddCreatedRecipeToMenu: (recipeId: string) => void;
  onViewShoppingList: () => void;
  onViewCalendar: () => void;
  onViewPantry: () => void;
  pendingApproval?: { pendingTools: PendingToolSummary[] } | null;
  approvalBusy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onDefineUnit?: (action: DefineUnitAction, ratio: number) => void | Promise<void>;
  defineUnitBusy?: boolean;
};

function isDefineUnitAction(raw: unknown): raw is DefineUnitAction {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    o.action_required === 'define_unit' &&
    typeof o.item === 'string' &&
    typeof o.from_unit === 'string' &&
    typeof o.to_unit === 'string'
  );
}

function DefineUnitCard({
  action,
  busy,
  onSubmit,
}: {
  action: DefineUnitAction;
  busy?: boolean;
  onSubmit?: (action: DefineUnitAction, ratio: number) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [ratioText, setRatioText] = useState('');
  const [saved, setSaved] = useState(false);
  const ratio = Number(ratioText);
  const canSubmit = Number.isFinite(ratio) && ratio > 0 && !busy && !saved;

  return (
    <View className="mt-3 bg-surface rounded-lg p-3 border border-line">
      <Text className="text-sm font-medium text-ink mb-2">
        {t('ai.defineUnitTitle')}
      </Text>
      <View className="flex-row items-center flex-wrap gap-1 mb-2">
        <Text className="text-sm text-ink">
          1 {action.from_unit} {action.item} =
        </Text>
        <TextInput
          value={ratioText}
          onChangeText={setRatioText}
          keyboardType="decimal-pad"
          editable={!saved && !busy}
          placeholder="___"
          className="min-w-[64px] px-2 py-1 border border-line rounded-md bg-linen text-ink text-sm"
        />
        <Text className="text-sm text-ink">{action.to_unit}</Text>
      </View>
      <TouchableOpacity
        disabled={!canSubmit}
        onPress={async () => {
          if (!canSubmit || !onSubmit) return;
          await onSubmit(action, ratio);
          setSaved(true);
        }}
        className={`py-2 rounded-lg items-center ${
          canSubmit ? 'bg-herb' : 'bg-sage border border-line'
        }`}
      >
        <Text
          className={`text-sm font-medium ${
            canSubmit ? 'text-white' : 'text-muted'
          }`}
        >
          {saved ? t('ai.defineUnitSaved') : t('common.confirm')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Compat: older cardData nested `{ recipe }`; current API uses flat fields. */
function normalizeRecipeCardData(cardData?: ChatCardData): ChatCardData {
  if (!cardData) return {};
  const nested = (cardData as ChatCardData & {
    recipe?: {
      id?: string;
      meal_name?: string;
      ingredients?: unknown[];
      instructions?: string[];
    };
  }).recipe;
  if (!nested || typeof nested !== 'object') return cardData;
  return {
    ...cardData,
    recipeId: cardData.recipeId ?? nested.id,
    recipeName: cardData.recipeName ?? nested.meal_name,
    ingredientCount:
      cardData.ingredientCount ??
      (Array.isArray(nested.ingredients) ? nested.ingredients.length : undefined),
    steps: cardData.steps ?? nested.instructions,
  };
}

function StreamingCaret() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 450, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        opacity,
        width: 2,
        height: 16,
        marginLeft: 2,
        marginBottom: 2,
        backgroundColor: colors.herb,
        alignSelf: 'flex-end',
      }}
    />
  );
}

function ChatMessageRowComponent({
  item,
  addingToMenuRecipeId,
  onViewCreatedRecipe,
  onAddCreatedRecipeToMenu,
  onViewShoppingList,
  onViewCalendar,
  onViewPantry,
  pendingApproval = null,
  approvalBusy = false,
  onApprove,
  onReject,
  onDefineUnit,
  defineUnitBusy = false,
}: ChatMessageRowProps) {
  const isUser = item.role === 'user';
  const showStreamingPlaceholder = Boolean(item.streaming && !item.content);
  const recipeCard =
    item.type === 'recipe_created' || item.type === 'recipe_imported'
      ? normalizeRecipeCardData(item.cardData)
      : null;

  return (
    <View className={`mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-herb'
            : item.type === 'error'
              ? 'bg-sage border border-line'
              : 'bg-surface border border-line'
        }`}
      >
        {showStreamingPlaceholder ? (
          <View className="gap-2">
            <View className="flex-row items-center gap-2 py-1">
              <ActivityIndicator size="small" color={colors.herb} />
              <Text className="text-muted text-sm">{item.statusText || 'Thinking…'}</Text>
            </View>
          </View>
        ) : (
          <View>
            <View className="flex-row flex-wrap items-end">
              <View className="flex-shrink">
                <ChatMessageContent
                  content={item.content}
                  isUser={isUser}
                  style={item.type === 'error' && !isUser ? { color: colors.danger } : undefined}
                />
              </View>
              {item.streaming ? <StreamingCaret /> : null}
            </View>
            {item.streaming && item.statusText ? (
              <Text className="mt-2 text-xs text-muted">{item.statusText}</Text>
            ) : null}
          </View>
        )}

        {item.type === 'interrupt' && pendingApproval ? (
          <View className="mt-3 pt-3 border-t border-line">
            <Text className="text-ink text-sm font-medium mb-2">Approve these changes?</Text>
            {pendingApproval.pendingTools.map((tool, index) => (
              <Text key={`${tool.name}-${index}`} className="text-xs text-muted mb-1">
                <Text className="font-medium text-ink">{tool.name}</Text>
                {tool.argsSummary ? ` — ${tool.argsSummary}` : ''}
              </Text>
            ))}
            <View className="flex-row gap-2 mt-2">
              <TouchableOpacity
                className="flex-1 bg-herb py-2 rounded-lg items-center"
                onPress={onApprove}
                disabled={approvalBusy}
              >
                <Text className="text-white text-sm">Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-sage py-2 rounded-lg items-center"
                onPress={onReject}
                disabled={approvalBusy}
              >
                <Text className="text-ink text-sm">Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {recipeCard ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-bold text-lg text-ink mb-1">
              {item.type === 'recipe_imported' ? 'Imported' : 'Recipe'}: {recipeCard.recipeName}
            </Text>
            <Text className="text-sm text-muted mb-3">
              {recipeCard.ingredientCount ?? 0} ingredients · {(recipeCard.steps ?? []).length}{' '}
              steps
            </Text>
            {(recipeCard.steps ?? []).length > 0 ? (
              <View className="mb-3">
                {(recipeCard.steps ?? []).map((step, index) => (
                  <View key={index} className="flex-row mb-2">
                    <View className="w-5 h-5 rounded-full bg-sage items-center justify-center mr-2 mt-0.5">
                      <Text className="text-xs font-medium text-herb-deep">{index + 1}</Text>
                    </View>
                    <Text className="flex-1 text-sm text-ink leading-5">{step}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={() => recipeCard.recipeId && onViewCreatedRecipe(recipeCard.recipeId)}
                className="flex-1 bg-sage py-2 rounded-lg items-center border border-line"
              >
                <Text className="text-herb-deep text-sm">Edit Recipe</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  recipeCard.recipeId && onAddCreatedRecipeToMenu(recipeCard.recipeId)
                }
                disabled={addingToMenuRecipeId === recipeCard.recipeId}
                className="flex-1 bg-sage py-2 rounded-lg items-center border border-line"
              >
                <Text className="text-herb-deep text-sm">Add to today's dinner</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {item.type === 'recipe_updated' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink">Updated: {item.cardData.recipeName}</Text>
            <TouchableOpacity
              onPress={() => item.cardData?.recipeId && onViewCreatedRecipe(item.cardData.recipeId)}
              className="mt-3 bg-sage py-2 rounded-lg items-center border border-line"
            >
              <Text className="text-herb-deep text-sm">Edit Recipe</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.type === 'shopping_list_updated' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink mb-2">
              Added {item.cardData.itemsAdded ?? 0} items to your shopping list
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {(item.cardData.items ?? []).map((shoppingItem, index) => (
                <View key={`${shoppingItem.name}-${index}`} className="bg-sage px-2 py-1 rounded-full">
                  <Text className="text-herb-deep text-xs">{shoppingItem.name}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              onPress={onViewShoppingList}
              className="bg-herb py-2 rounded-lg items-center"
            >
              <Text className="text-white text-sm">View Shopping List</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.type === 'meal_plan_updated' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink mb-2">
              {item.cardData.mealsScheduled
                ? `Scheduled ${item.cardData.mealsScheduled} meal(s)`
                : `${item.cardData.recipeName} - ${item.cardData.mealType} on ${item.cardData.servingDate}`}
            </Text>
            <TouchableOpacity
              onPress={onViewCalendar}
              className="bg-herb py-2 rounded-lg items-center"
            >
              <Text className="text-white text-sm">Open Calendar</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.type === 'pantry_updated' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink mb-2">
              {item.cardData.removedDuplicates != null
                ? `Pantry organized - merged ${item.cardData.mergedGroups ?? 0} group(s)`
                : `Added ${item.cardData.itemsAdded ?? 0} item(s) to pantry`}
            </Text>
            <TouchableOpacity onPress={onViewPantry} className="bg-herb py-2 rounded-lg items-center">
              <Text className="text-white text-sm">Open Pantry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.type === 'meal_suggestions' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink mb-2">Meal suggestions</Text>
            {(item.cardData.suggestions ?? []).map((s, index) => {
              const name = s.recipeName ?? s.meal_name;
              const pct = s.matchScore;
              const status =
                s.cookStatus === 'conditionally_cookable'
                  ? ' · if staples'
                  : s.cookStatus === 'cookable'
                    ? ' · cookable'
                    : '';
              return (
              <Text key={index} className="text-sm text-muted">
                {name}
                {pct != null ? ` - ${pct}% match` : ''}
                {status}
              </Text>
              );
            })}
            {(item.cardData.actions ?? [])
              .filter(isDefineUnitAction)
              .map((action, index) => (
                <DefineUnitCard
                  key={`${action.item}-${action.from_unit}-${action.to_unit}-${index}`}
                  action={action}
                  busy={defineUnitBusy}
                  onSubmit={onDefineUnit}
                />
              ))}
            <TouchableOpacity
              onPress={onViewCalendar}
              className="mt-3 bg-sage py-2 rounded-lg items-center border border-line"
            >
              <Text className="text-herb-deep text-sm">View Calendar</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {item.type === 'multi_action' && item.cardData ? (
          <View className="mt-3 bg-linen rounded-xl p-4 border border-line">
            <Text className="font-medium text-ink">
              Completed {item.cardData.actionCount ?? 0} action(s)
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const ChatMessageRow = memo(ChatMessageRowComponent);
