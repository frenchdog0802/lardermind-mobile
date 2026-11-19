import React, { memo, useCallback } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { TrashIcon } from 'lucide-react-native';
import { UnitSelect } from '../UnitSelect';
import type { MeasurementSystem } from '../../utils/units';
import { colors } from '../../theme/tokens';

export type RecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
  ingredient_id?: string;
  unit_kind?: string;
  base_unit?: string;
  default_display_unit?: string;
};

type RecipeIngredientRowProps = {
  item: RecipeIngredient;
  index: number;
  measurementSystem: MeasurementSystem;
  onUpdate: (index: number, field: 'name' | 'quantity' | 'unit', value: string) => void;
  onRemove: (index: number) => void;
  nameTestID?: string;
  namePlaceholder?: string;
};

function RecipeIngredientRowComponent({
  item,
  index,
  measurementSystem,
  onUpdate,
  onRemove,
  nameTestID,
  namePlaceholder,
}: RecipeIngredientRowProps) {
  const handleNameChange = useCallback(
    (text: string) => onUpdate(index, 'name', text),
    [index, onUpdate],
  );
  const handleQuantityChange = useCallback(
    (text: string) => onUpdate(index, 'quantity', text),
    [index, onUpdate],
  );
  const handleUnitChange = useCallback(
    (unit: string) => onUpdate(index, 'unit', unit),
    [index, onUpdate],
  );
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);

  // Only lock the unit picker when catalog/kind is known; bare "pcs" defaults stay open
  const resolvedKind = item.unit_kind || undefined;

  return (
    <View className="mb-2 gap-2">
      <View className="flex-row items-center gap-2">
        <TextInput
          testID={nameTestID}
          value={item.name}
          onChangeText={handleNameChange}
          placeholder={namePlaceholder}
          autoComplete="off"
          autoCorrect={false}
          textContentType="none"
          importantForAutofill="no"
          className="flex-1 p-3 border border-line rounded-lg bg-linen text-ink"
        />
        <TextInput
          value={item.quantity.toString()}
          onChangeText={handleQuantityChange}
          keyboardType="numeric"
          autoComplete="off"
          textContentType="none"
          className="w-16 p-3 border border-line rounded-lg bg-linen text-ink text-center"
        />
        <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={handleRemove} className="p-2">
          <TrashIcon size={18} color={colors.danger} />
        </TouchableOpacity>
      </View>
      <UnitSelect
        kind={resolvedKind}
        value={item.unit}
        onChange={handleUnitChange}
        measurementSystem={measurementSystem}
        preferSystemUnits
      />
    </View>
  );
}

export const RecipeIngredientRow = memo(RecipeIngredientRowComponent);
