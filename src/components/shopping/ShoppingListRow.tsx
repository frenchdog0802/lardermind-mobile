import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { PlusIcon, MinusIcon, CheckIcon, TrashIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { QuantityLabel } from '../UnitSelect';
import type { MeasurementSystem } from '../../utils/units';
import { colors } from '../../theme/tokens';

export type ShoppingListRowItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  checked: boolean;
  synced_to_pantry?: boolean;
  ingredient_id?: string;
  unit_kind?: string;
  base_unit?: string;
  default_display_unit?: string;
};

type ShoppingListRowProps = {
  item: ShoppingListRowItem;
  measurementSystem: MeasurementSystem;
  onToggle: (id: string) => void;
  onUpdateQuantity: (item: ShoppingListRowItem, delta: number) => void;
  onRemove: (id: string) => void;
};

function ShoppingListRowComponent({
  item,
  measurementSystem,
  onToggle,
  onUpdateQuantity,
  onRemove,
}: ShoppingListRowProps) {
  const { t } = useTranslation();

  return (
    <View
      className={`flex-row items-center p-3 bg-surface rounded-xl mb-2 border border-line ${
        item.checked ? 'opacity-70' : ''
      }`}
    >
      <Pressable
        onPress={() => onToggle(item.id)}
        style={{ marginRight: 16 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
      >
        <View
          className={`w-6 h-6 rounded border-2 items-center justify-center ${
            item.checked ? 'bg-herb border-herb' : 'border-line'
          }`}
        >
          {item.checked ? <CheckIcon size={14} color="#fff" /> : null}
        </View>
      </Pressable>

      <View className="flex-1 mr-3">
        <Text
          className={`font-semibold capitalize ${item.checked ? 'line-through text-muted' : 'text-ink'}`}
          numberOfLines={1}
          style={{ color: item.checked ? colors.muted : colors.ink }}
        >
          {item.name}
        </Text>
        {item.checked ? (
          <Text
            className="text-xs mt-0.5"
            style={{ color: item.synced_to_pantry ? colors.herbDeep : '#92400e' }}
          >
            {item.synced_to_pantry
              ? t('shopping.syncedToPantry')
              : t('shopping.pendingSync')}
          </Text>
        ) : null}
      </View>

      <View className="flex-row items-center gap-1.5 mr-2" style={{ flexShrink: 0 }}>
        <Pressable
          onPress={() => onUpdateQuantity(item, -0.5)}
          style={{
            backgroundColor: colors.linen,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <MinusIcon size={16} color={colors.ink} />
        </Pressable>

        <QuantityLabel
          quantity={item.quantity}
          unit={item.unit}
          measurementSystem={measurementSystem}
          unitKind={item.unit_kind}
          baseUnit={item.base_unit}
          defaultDisplayUnit={item.default_display_unit}
        />

        <Pressable
          onPress={() => onUpdateQuantity(item, 0.5)}
          style={{
            backgroundColor: colors.linen,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <PlusIcon size={16} color={colors.ink} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => onRemove(item.id)}
        style={{ padding: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Remove item"
      >
        <TrashIcon size={18} color={colors.danger} />
      </Pressable>
    </View>
  );
}

export const ShoppingListRow = memo(ShoppingListRowComponent);
