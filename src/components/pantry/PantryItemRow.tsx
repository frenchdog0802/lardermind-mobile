import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { PlusIcon, MinusIcon, TrashIcon } from 'lucide-react-native';
import { QuantityLabel } from '../UnitSelect';
import type { MeasurementSystem } from '../../utils/units';
import type { PantryItem } from '../../types';
import { colors } from '../../theme/tokens';

type PantryItemRowProps = {
  item: PantryItem;
  measurementSystem: MeasurementSystem;
  onUpdateQuantity: (item: PantryItem, delta: number) => void;
  onRemove: (id: string) => void;
};

function PantryItemRowComponent({
  item,
  measurementSystem,
  onUpdateQuantity,
  onRemove,
}: PantryItemRowProps) {
  return (
    <View className="flex-row items-center p-3 bg-surface rounded-xl mb-2 border border-line">
      <View className="flex-1 mr-3">
        <Text
          className="font-semibold text-ink capitalize"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {item.name}
        </Text>
      </View>

      <View className="flex-row items-center gap-1.5 mr-2" style={{ flexShrink: 0 }}>
        <Pressable hitSlop={6}
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
          unitKind={item.unit_kind}
          baseUnit={item.base_unit}
          defaultDisplayUnit={item.default_display_unit}
          measurementSystem={measurementSystem}
          style={{
            minWidth: 72,
            textAlign: 'center',
            fontWeight: '700',
            fontSize: 14,
            paddingHorizontal: 4,
            color: colors.ink,
          }}
        />

        <Pressable hitSlop={6}
          onPress={() => onUpdateQuantity(item, 0.5)}
          style={{ backgroundColor: colors.herb, padding: 8, borderRadius: 8 }}
        >
          <PlusIcon size={16} color={colors.onHerb} />
        </Pressable>
      </View>

      <Pressable hitSlop={6} onPress={() => onRemove(item.id)} style={{ padding: 8 }}>
        <TrashIcon size={18} color={colors.danger} />
      </Pressable>
    </View>
  );
}

export const PantryItemRow = memo(PantryItemRowComponent);
