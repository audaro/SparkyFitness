export interface DailyGoals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  saturated_fat?: number;
  polyunsaturated_fat?: number;
  monounsaturated_fat?: number;
  trans_fat?: number;
  cholesterol?: number;
  sodium?: number;
  potassium?: number;
  dietary_fiber: number;
  sugars?: number;
  vitamin_a?: number;
  vitamin_c?: number;
  calcium?: number;
  iron?: number;
  water_goal_ml?: number;
  target_exercise_calories_burned?: number;
  target_exercise_duration_minutes?: number;
  // Null, not merely absent: the goals row stores these as nullable columns and
  // the daily-summary response passes them through, so an unset macro split
  // arrives as null rather than being omitted.
  protein_percentage?: number | null;
  carbs_percentage?: number | null;
  fat_percentage?: number | null;
  breakfast_percentage?: number;
  lunch_percentage?: number;
  dinner_percentage?: number;
  snacks_percentage?: number;
  custom_nutrients?: Record<string, string | number>;
  custom_meal_percentages?: Record<string, number>;
}
