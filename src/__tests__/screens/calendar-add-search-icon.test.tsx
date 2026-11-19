/**
 * Regression: Add to Calendar recipe search icon must be wrapped in an
 * absolutely positioned View (same pattern as Shopping / Recipes).
 * Lucide icons ignore NativeWind absolute className on the icon itself.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import CalendarScreen from '../../screens/CalendarScreen';

jest.mock('../../contexts/pantryContext', () => ({
  usePantry: () => ({
    mealPlan: [],
    recipes: [
      {
        id: 'r1',
        meal_name: 'Tomato Pasta',
        folder_id: '',
        instructions: [],
        ingredients: [],
        image: null,
      },
    ],
    addMealPlan: jest.fn(),
    deleteMealPlan: jest.fn(),
    fetchAllMealPlans: jest.fn(async () => undefined),
    fetchAllRecipes: jest.fn(async () => undefined),
    confirmMealPlan: jest.fn(),
    skipMealPlan: jest.fn(),
  }),
  normalizeRecipe: (r: Record<string, unknown>) => r,
}));

jest.mock('../../api/recipe', () => ({
  recipeApi: {
    get: jest.fn(),
  },
}));

jest.mock('react-native-calendars', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Calendar: () => React.createElement(View, { testID: 'rn-calendar' }),
  };
});

jest.mock('../../components/AppHeader', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({
      title,
      onRightPress,
    }: {
      title: string;
      onRightPress?: () => void;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, title),
        React.createElement(
          TouchableOpacity,
          { testID: 'calendar-header-add', onPress: onRightPress },
          React.createElement(Text, null, 'Add'),
        ),
      ),
  };
});

describe('CalendarScreen Add to Calendar search icon', () => {
  it('wraps the recipe search icon in an absolute-positioned view', () => {
    const { getByTestId, getByPlaceholderText } = render(<CalendarScreen />);

    fireEvent.press(getByTestId('calendar-header-add'));

    expect(getByPlaceholderText('Search recipe...')).toBeTruthy();
    expect(getByTestId('calendar-recipe-search-icon-wrap')).toBeTruthy();
  });
});
