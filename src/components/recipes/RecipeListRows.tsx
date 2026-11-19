import React, { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  FolderIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
} from 'lucide-react-native';
import type { Folder, Recipe } from '../../types';
import { colors } from '../../theme/tokens';

type FolderRowProps = {
  folder: Folder;
  recipeCount: number;
  showActions: boolean;
  onOpen: (folder: Folder) => void;
  onToggleActions: (folderId: string | null) => void;
  onRename: (folder: Folder) => void;
  onAddRecipe: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
};

function FolderRowComponent({
  folder,
  recipeCount,
  showActions,
  onOpen,
  onToggleActions,
  onRename,
  onAddRecipe,
  onDelete,
}: FolderRowProps) {
  return (
    <TouchableOpacity
      testID={`folder-row-${folder.id}`}
      onPress={() => onOpen(folder)}
      className="bg-surface rounded-xl p-4 mb-3 border border-line"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <FolderIcon size={20} color={colors.herb} />
          <Text className="font-medium text-ink ml-2">{folder.name}</Text>
        </View>
        <View className="flex-row items-center">
          <Text className="text-muted text-sm mr-2">{recipeCount} recipes</Text>
          <TouchableOpacity hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            onPress={() => onToggleActions(showActions ? null : folder.id)}
            className="p-1"
          >
            <MoreVerticalIcon size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </View>

      {showActions ? (
        <View className="absolute right-2 top-12 bg-surface rounded-lg border border-line z-10 w-36">
          <TouchableOpacity
            onPress={() => onRename(folder)}
            className="flex-row items-center p-3 border-b border-line"
          >
            <PencilIcon size={14} color={colors.ink} />
            <Text className="text-ink ml-2">Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onAddRecipe(folder)}
            className="flex-row items-center p-3 border-b border-line"
          >
            <PlusIcon size={14} color={colors.ink} />
            <Text className="text-ink ml-2">Add Recipe</Text>
          </TouchableOpacity>
          {folder.name.toLowerCase() !== 'uncategorized' ? (
            <TouchableOpacity
              onPress={() => onDelete(folder)}
              className="flex-row items-center p-3"
            >
              <TrashIcon size={14} color={colors.danger} />
              <Text className="ml-2" style={{ color: colors.danger }}>
                Delete
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

type RecipeRowProps = {
  recipe: Recipe;
  onOpen: (recipe: Recipe) => void;
  onEdit: (recipe: Recipe) => void;
  onDelete: (id: string) => void;
};

function RecipeRowComponent({ recipe, onOpen, onEdit, onDelete }: RecipeRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onOpen(recipe)}
      className="bg-surface rounded-xl p-4 mb-3 border border-line"
    >
      <View className="flex-row justify-between items-start">
        <View className="flex-1">
          <Text className="font-medium text-ink text-lg">{recipe.meal_name}</Text>
          <Text className="text-muted text-sm mt-1">
            {recipe.ingredients?.length || 0} ingredient
            {(recipe.ingredients?.length || 0) !== 1 ? 's' : ''}
          </Text>
        </View>
        <View className="flex-row">
          <TouchableOpacity hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            onPress={() => onEdit(recipe)}
            className="p-2"
          >
            <EditIcon size={18} color={colors.herb} />
          </TouchableOpacity>
          <TouchableOpacity hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }} onPress={() => onDelete(recipe.id)} className="p-2">
            <TrashIcon size={18} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export const FolderRow = memo(FolderRowComponent);
export const RecipeRow = memo(RecipeRowComponent);
