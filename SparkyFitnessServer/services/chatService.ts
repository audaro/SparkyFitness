import chatRepository from '../models/chatRepository.js';
import measurementRepository from '../models/measurementRepository.js';
import { log } from '../config/logging.js';
import { getDefaultModel } from '../ai/config.js';
import undici from 'undici';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import { todayInZone } from '@workspace/shared';
const { Agent } = undici; // Import Agent from undici
async function handleAiServiceSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceData: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any
) {
  try {
    if (action === 'save_ai_service_settings') {
      serviceData.user_id = authenticatedUserId; // Ensure user_id is set from authenticated user
      // Allow creating services without API keys - they can be added later via update
      // API key validation happens when actually using the service (in processChatMessage)
      // This enables the override workflow where users create a service and add API key later
      const result = await chatRepository.upsertAiServiceSetting(serviceData);
      if (!result) {
        throw new Error('AI service setting not found.');
      }
      const { _encrypted_api_key, _api_key_iv, _api_key_tag, ...safeSetting } =
        result;
      return {
        message: 'AI service settings saved successfully.',
        setting: safeSetting,
      };
    }
    // Add other actions if needed in the future
    throw new Error('Unsupported action for AI service settings.');
  } catch (error) {
    log(
      'error',
      `Error handling AI service settings for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function getAiServiceSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any
) {
  try {
    const settings =
      await chatRepository.getAiServiceSettingsByUserId(targetUserId);
    return settings || []; // Return empty array if no settings found
  } catch (error) {
    log(
      'error',
      `Error fetching AI service settings for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    return []; // Return empty array on error
  }
}

async function getActiveAiServiceSetting(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any
) {
  try {
    const setting =
      await chatRepository.getActiveAiServiceSetting(targetUserId);
    if (setting) {
      const source = setting.source || 'unknown';
      log(
        'info',
        `Active AI service setting for user ${targetUserId} (source: ${source})`
      );
    }
    return setting; // Returns null if no active setting found
  } catch (error) {
    log(
      'error',
      `Error fetching active AI service setting for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    return null; // Return null on error
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteAiServiceSetting(authenticatedUserId: any, id: any) {
  try {
    // Verify that the setting belongs to the authenticated user before deleting
    const setting = await chatRepository.getAiServiceSettingById(
      id,
      authenticatedUserId
    );
    if (!setting) {
      throw new Error('AI service setting not found.');
    }
    const success = await chatRepository.deleteAiServiceSetting(
      id,
      authenticatedUserId
    );
    if (!success) {
      throw new Error('AI service setting not found.');
    }
    return { message: 'AI service setting deleted successfully.' };
  } catch (error) {
    log(
      'error',
      `Error deleting AI service setting ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearOldChatHistory(authenticatedUserId: any) {
  try {
    await chatRepository.clearOldChatHistory(authenticatedUserId);
    return { message: 'Old chat history cleared successfully.' };
  } catch (error) {
    log(
      'error',
      `Error clearing old chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function getSparkyChatHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any
) {
  try {
    const history = await chatRepository.getChatHistoryByUserId(targetUserId);
    return history;
  } catch (error) {
    log(
      'error',
      `Error fetching chat history for user ${targetUserId} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSparkyChatHistoryEntry(authenticatedUserId: any, id: any) {
  try {
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(
      id,
      authenticatedUserId
    );
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    const entry = await chatRepository.getChatHistoryEntryById(
      id,
      authenticatedUserId
    );
    return entry;
  } catch (error) {
    log(
      'error',
      `Error fetching chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function updateSparkyChatHistoryEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateData: any
) {
  try {
    // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(id);
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    if (entryOwnerId !== authenticatedUserId) {
      throw new Error(
        'Forbidden: You do not have permission to update this chat history entry.'
      );
    }
    const updatedEntry = await chatRepository.updateChatHistoryEntry(
      id,
      authenticatedUserId,
      updateData
    );
    if (!updatedEntry) {
      throw new Error(
        'Chat history entry not found or not authorized to update.'
      );
    }
    return updatedEntry;
  } catch (error) {
    log(
      'error',
      `Error updating chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteSparkyChatHistoryEntry(authenticatedUserId: any, id: any) {
  try {
    // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
    const entryOwnerId = await chatRepository.getChatHistoryEntryOwnerId(id);
    if (!entryOwnerId) {
      throw new Error('Chat history entry not found.');
    }
    if (entryOwnerId !== authenticatedUserId) {
      throw new Error(
        'Forbidden: You do not have permission to delete this chat history entry.'
      );
    }
    const success = await chatRepository.deleteChatHistoryEntry(
      id,
      authenticatedUserId
    );
    if (!success) {
      throw new Error('Chat history entry not found.');
    }
    return { message: 'Chat history entry deleted successfully.' };
  } catch (error) {
    log(
      'error',
      `Error deleting chat history entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clearAllSparkyChatHistory(authenticatedUserId: any) {
  try {
    await chatRepository.clearAllChatHistory(authenticatedUserId);
    return { message: 'All chat history cleared successfully.' };
  } catch (error) {
    log(
      'error',
      `Error clearing all chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function saveSparkyChatHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  historyData: any
) {
  try {
    // Ensure the history is saved for the authenticated user
    historyData.user_id = authenticatedUserId;
    await chatRepository.saveChatHistory(historyData);
    return { message: 'Chat history saved successfully.' };
  } catch (error) {
    log(
      'error',
      `Error saving chat history for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function processChatMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceConfigId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any
) {
  try {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid messages format.');
    }
    if (!serviceConfigId) {
      // Check if serviceConfigId is provided
      throw new Error('AI service configuration ID is missing.');
    }
    const aiService = await chatRepository.getAiServiceSettingForBackend(
      serviceConfigId,
      authenticatedUserId
    );
    if (!aiService) {
      throw new Error('AI service setting not found for the provided ID.');
    }
    // Log which source was used
    const source = aiService.source || 'unknown';
    log(
      'info',
      `Processing chat message for user ${authenticatedUserId} using AI service from ${source} (ID: ${serviceConfigId})`
    );
    // Ensure API key is present, unless it's Ollama
    if (aiService.service_type !== 'ollama' && !aiService.api_key) {
      throw new Error('API key missing for selected AI service.');
    }
    let response;
    const model =
      aiService.model_name || getDefaultModel(aiService.service_type);
    // Comprehensive system prompt from old Supabase Edge Function
    // Fetch user's custom categories to provide context to the AI
    const [customCategories, chatTz] = await Promise.all([
      measurementRepository.getCustomCategories(authenticatedUserId),
      loadUserTimezone(authenticatedUserId),
    ]);
    const customCategoriesList =
      customCategories.length > 0
        ? customCategories
            .map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (cat: any) =>
                `- ${cat.name} (${cat.measurement_type}, ${cat.frequency})`
            )
            .join('\n')
        : 'None';
    const systemPromptContent = `You are Sparky, an AI nutrition and wellness coach. Your primary goal is to help users track their food, exercise, and measurements, and provide helpful advice and motivation based on their data and general health knowledge.

The current date is ${todayInZone(chatTz)}.

**CRITICAL INSTRUCTION:** When the user mentions "water" in any context related to consumption or intake, you MUST use the 'log_water' intent. Do NOT classify water as a 'log_food' item.

You will receive user input, which can include text and/or images. Your task is to identify the user's intent and extract relevant data. You MUST respond with a JSON object containing the 'intent' and 'data', strictly adhering to the defined intents and their required data structures.

For image inputs:
- Analyze the image to identify food items, estimate quantities, and infer nutritional information.
- If the image clearly shows food, prioritize the 'log_food' intent.
- Extract food_name, quantity, unit, and meal_type from the image content.
- **CRITICAL:** Always infer and include *estimated* nutritional details (calories, protein, carbs, fat, etc.) based on the identified food and estimated quantity, populating the corresponding fields in the 'log_food' intent's data. Do NOT default to 0 if an estimation can be made.
- If the image is not food-related or unclear, treat the text input as primary.

**IMPORTANT:** If the user specifies a date or time (e.g., "yesterday", "last Monday", "at 7 PM"), extract this information and include it as a 'entryDate' field in the top level of the JSON object. **Provide relative terms like "today", "yesterday", "tomorrow", or a specific date in 'MM-DD' or 'YYYY-MM-DD' format. Do NOT try to resolve relative terms to a full date yourself.** If no date is specified, omit the 'entryDate' field.

When the user mentions logging food, exercise, or measurements, prioritize extracting the exact name of the item (food name, exercise name, measurement name) as accurately as possible from the user's input. This is crucial for looking up existing items in the database.

Here are the user's existing custom measurement categories:
${customCategoriesList}

When the user mentions a custom measurement, compare it to the list above. If you find a match or a very similar variation (considering synonyms and capitalization), use the **exact name** from the list in the 'name' field of the measurement data. If no clear match is found in the list, use the name as provided by the user.

**For 'log_food' intent, pay close attention to the unit specified by the user and match it in the 'unit' field of the food data.**
- If the user says "gram" or "g", use "g".
- If the user says "cup" or "cups", use "cup".
- If the user refers to individual items by count (e.g., "two apples", "3 eggs"), use "piece".
- If the unit is not explicitly mentioned, infer the most appropriate unit based on the food item and context (e.g., "apple" is likely "piece", "rice" is likely "g" or "cup"). Refer to common food units used in the application (like 'g', 'cup', 'oz', 'ml', 'serving', 'piece').

Possible intents and their required data. You MUST select one of these intents and provide the data in the specified format:
- 'log_food': User wants to log food. This intent is for solid food items or beverages that are not water. **This intent MUST NOT be used for logging water intake.**
  - If you can confidently identify a single food item and its details, data should include:
    - food_name: string (e.g., "apple", "chicken breast", "Dosa") - Extract the most likely exact name.
    - quantity: number (e.g., 1, 100) - Infer if possible, default to 1 if a specific quantity isn't clear but a food is mentioned.
    - unit: string (e.g., "piece", "g", "oz", "ml", "cup", "serving") - **CRITICAL: Match the user's specified unit exactly.** If the user refers to individual items by count (e.g., "two apples", "3 eggs"), use "piece". If no unit is explicitly mentioned, infer the most appropriate unit based on the food item and context (e.g., "apple" is likely "piece", "rice" is likely "g" or "cup"). Refer to common food units used in the application (like 'g', 'cup', 'oz', 'ml', 'serving', 'piece').
    - meal_type: string ("breakfast", "lunch", "dinner", "snacks") - Infer based on time of day or context, default to "snacks".
    - **Include as many of the following nutritional fields as you can extract from the user's input or your knowledge about the food:**
      - calories: number
      - protein: number
      - carbs: number
      - fat: number
      - saturated_fat: number
      - polyunsaturated_fat: number
      - monounsaturated_fat: number
      - trans_fat: number
      - cholesterol: number
      - sodium: number
      - potassium: number
      - dietary_fiber: number
      - sugars: number
      - vitamin_a: number
      - vitamin_c: number
      - calcium: number
      - iron: number
      - FoodOption: array of realistic food options (if applicable)
      - serving_size: number
      - serving_unit: string


- 'log_exercise': User wants to log exercise. Data should include:
 - exercise_name: string (e.g., "running", "yoga") - Extract the most likely exact name.
 - duration_minutes: number | null (e.g., 30, 60) - Infer if possible.
 - distance: number | null (e.g., 5, 3.1) - Infer if mentioned.
 - distance_unit: string | null ("miles", "km") - Infer if mentioned.
- 'log_measurement': User wants to log a body measurement or steps. Data should include an array of measurements:
 - measurements: Array of objects, each with:
   - type: string ("weight", "neck", "waist", "hips", "steps", "custom") - Use "custom" for any measurement not in the standard list.
   - value: number
   - unit: string | null (e.g., "kg", "lbs", "cm", "inches", "steps") - Infer if possible, default to null for steps.
   - name: string | null (required if type is "custom") - **Crucially, if the user mentions a custom category from the list provided, use its exact name here.**
- 'log_water': User wants to log water intake. This intent should be prioritized when the user mentions "water" in conjunction with a quantity or a desire to log water. The AI should understand from the user's context that they are referring to drinking water. Data should include:
 - glasses_consumed: number (e.g., 1, 2) - Infer if possible, default to 1.
- 'propose_workout_routine': **THE ONLY intent for any workout routine request.** Use this whenever the user asks you to "create / make / design / build / suggest / generate / give me / write me" a routine, workout, split, program, "day" (e.g. "leg day", "push day"), or plan. Examples: "make me a push day", "design a 3-day full-body routine", "build me a beginner program", "create an upper/lower split", "suggest a leg day", "write me an arm workout".

  **CRITICAL RULES:**
  1. The system shows the user your 'response' text PLUS a one-click "Import" button. NEVER tell the user to type "import" — the button handles it. NEVER auto-save without the user clicking.
  2. **Generate exactly the routine the user asked for.** If they say "make me a leg day", produce a LEG DAY (squats, leg press, lunges, leg curls, calf raises, etc.) — do NOT regenerate or include previously-discussed push/pull days. Each user request stands on its own.
  3. **"Same parameters as before"** means same *structure* — same duration target, same difficulty, same equipment constraints, similar set/rep schemes. It does NOT mean repeat the same exercises. Apply the parameters to the NEW body part / focus they requested.
  4. **NEVER refuse and respond with chat text** for a workout-routine request. If you cannot produce a routine, still emit 'propose_workout_routine' with your best draft. Plain chat responses for routine requests are forbidden.
  5. If the user says "import this", "save this", "add this to my routines" referring to a routine you just proposed — DO NOTHING. Respond with 'chat' intent and a short message: "Click the Import button on the routine above to save it." The button is the only path.

  Your 'response' field MUST contain the human-readable routine description (markdown rendered: use **bold** for headings, dashes or numbered lists for exercises). The 'data' field MUST contain the structured routine.

  **If the routine spans multiple days** (e.g., "Day 1: Push, Day 2: Pull, Day 3: Legs"), output a JSON ARRAY where each element is a separate 'propose_workout_routine' object — one per day. Each day becomes its own preset. Name each day clearly (e.g., "Push Day", "Pull Day", "Leg Day").

  Data should include:
 - name: string (e.g., "Push Day", "Leg Day", "Beginner Full Body") - A short descriptive name matching what the user requested.
 - description: string | null - Optional short description of the routine.
 - exercises: Array of exercise objects, each with:
   - exercise_name: string (e.g., "Bench Press", "Barbell Squat", "Plank") - Use a clear common name.
   - category: string ("strength" or "cardio") - Infer based on the exercise.
   - sets: Array of set objects (1 entry per set). Each set has:
     - set_number: number (1-based, ordered)
     - set_type: string (default "Working Set"; use "Warm-up" only for explicit warm-up sets)
     - reps: number | null (for strength sets; null for cardio/timed)
     - weight: number | null (in the user's stated unit; null if bodyweight or unknown)
     - duration: number | null (in MINUTES, for cardio/timed/plank-style sets; null otherwise)
     - rest_time: number | null (in seconds; only include if user specifies)
     - notes: string | null (only if user specified)
   - For strength like "3x8": output 3 set objects each with reps: 8.
   - For ranges like "8-12 reps": pick the lower end (8).
   - For cardio like "20 minutes of running": one exercise with one set with duration: 20.
   - For a hold like "plank 3x60s": three sets each with duration in MINUTES (so duration: 1 for 60s).
- 'ask_question': User is asking a general question or seeking advice. Data is an empty object {}.
- 'chat': User is engaging in casual conversation. Data is an empty object {}.

If the intent is 'ask_question' or 'chat', also provide a 'response' field with a friendly and helpful text response. For logging intents, the 'response' field is optional and can be a simple confirmation or encouraging remark.

If you cannot determine the intent or extract data with high confidence, default to 'ask_question' or 'chat' and provide a suitable response asking for clarification.

Output format MUST be a JSON object with 'intent' (string) and 'data' (object) fields, and optionally 'entryDate' (string with relative term or date format). Do NOT include any other text outside the JSON object.

Example JSON output for logging weight for yesterday:
{"intent": "log_measurement", "data": {"measurements": [{"type": "weight", "value": 70, "unit": "kg"}]}, "entryDate": "yesterday"}

Example JSON output for asking a question:
{"intent": "ask_question", "data": {}, "response": "I can help with that! What's your question?"}

Example JSON output for logging steps:
{"intent": "log_measurement", "data": {"measurements": [{"type": "steps", "value": 10000, "unit": "steps"}]}}

Example JSON output for logging food for today with detailed nutrition:
{"intent": "log_food", "data": {"food_name": "apple", "quantity": 1, "unit": "piece", "meal_type": "snack", "calories": 95, "carbs": 25, "sugars": 19, "dietary_fiber": 4, "vitamin_c": 9}, "entryDate": "today"}

Example JSON output for logging exercise:
{"intent": "log_exercise", "data": {"exercise_name": "running", "duration_minutes": 30, "distance": 3, "distance_unit": "miles"}, "entryDate": "06-18"}

Example JSON output for logging a custom measurement (e.g., Blood Sugar), using the exact name from the provided list:
{"intent": "log_measurement", "data": {"measurements": [{"type": "custom", "name": "Blood Sugar", "value": 140, "unit": "mg/dL"}]}, "entryDate": "today"}

Example JSON output for logging water:
{"intent": "log_water", "data": {"glasses_consumed": 2}, "entryDate": "today"}

Example JSON output for proposing a NEW body-part-specific day after the user has discussed other routines ("Make me a leg day with the same parameters as before"):
{"intent": "propose_workout_routine", "response": "Here's a **Leg Day** matching the same hour-long, intermediate format:\\n\\n1. **Barbell Squat** — 4 × 8\\n2. **Leg Press** — 3 × 10\\n3. **Romanian Deadlift** — 3 × 10\\n4. **Walking Lunges** — 3 × 12 per leg\\n5. **Leg Curl Machine** — 3 × 12\\n6. **Standing Calf Raise** — 3 × 15\\n\\nClick Import below to save it as a workout preset.", "data": {"name": "Leg Day", "description": "Quads, hamstrings, glutes, calves", "exercises": [{"exercise_name": "Barbell Squat", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 8}, {"set_number": 2, "set_type": "Working Set", "reps": 8}, {"set_number": 3, "set_type": "Working Set", "reps": 8}, {"set_number": 4, "set_type": "Working Set", "reps": 8}]}, {"exercise_name": "Leg Press", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 10}, {"set_number": 2, "set_type": "Working Set", "reps": 10}, {"set_number": 3, "set_type": "Working Set", "reps": 10}]}, {"exercise_name": "Romanian Deadlift", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 10}, {"set_number": 2, "set_type": "Working Set", "reps": 10}, {"set_number": 3, "set_type": "Working Set", "reps": 10}]}, {"exercise_name": "Walking Lunges", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 12}, {"set_number": 2, "set_type": "Working Set", "reps": 12}, {"set_number": 3, "set_type": "Working Set", "reps": 12}]}, {"exercise_name": "Leg Curl Machine", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 12}, {"set_number": 2, "set_type": "Working Set", "reps": 12}, {"set_number": 3, "set_type": "Working Set", "reps": 12}]}, {"exercise_name": "Standing Calf Raise", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 15}, {"set_number": 2, "set_type": "Working Set", "reps": 15}, {"set_number": 3, "set_type": "Working Set", "reps": 15}]}]}}

Example JSON output for proposing a workout routine ("Make me a push day with bench press 3x8 at 60kg, overhead press 3x10, and tricep dips 3x12"):
{"intent": "propose_workout_routine", "response": "Here's a **Push Day** for you:\\n\\n1. **Bench Press** — 3 sets × 8 reps @ 60kg\\n2. **Overhead Press** — 3 sets × 10 reps\\n3. **Tricep Dips** — 3 sets × 12 reps\\n\\nClick Import below to save it as a workout preset.", "data": {"name": "Push Day", "description": "Chest, shoulders, and triceps", "exercises": [{"exercise_name": "Bench Press", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 8, "weight": 60}, {"set_number": 2, "set_type": "Working Set", "reps": 8, "weight": 60}, {"set_number": 3, "set_type": "Working Set", "reps": 8, "weight": 60}]}, {"exercise_name": "Overhead Press", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 10}, {"set_number": 2, "set_type": "Working Set", "reps": 10}, {"set_number": 3, "set_type": "Working Set", "reps": 10}]}, {"exercise_name": "Tricep Dips", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 12}, {"set_number": 2, "set_type": "Working Set", "reps": 12}, {"set_number": 3, "set_type": "Working Set", "reps": 12}]}]}}

Example JSON output for a multi-day proposal ("Make me a 3-day push/pull/legs split"):
[{"intent": "propose_workout_routine", "response": "**Day 1 — Push Day**\\n\\n1. Bench Press — 3×8\\n2. Overhead Press — 3×10\\n3. Tricep Dips — 3×12", "data": {"name": "Push Day", "description": "Chest, shoulders, triceps", "exercises": [{"exercise_name": "Bench Press", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 8}, {"set_number": 2, "set_type": "Working Set", "reps": 8}, {"set_number": 3, "set_type": "Working Set", "reps": 8}]}]}}, {"intent": "propose_workout_routine", "response": "**Day 2 — Pull Day**\\n\\n1. Lat Pulldown — 3×8\\n2. Seated Row — 3×10\\n3. Bicep Curls — 3×12", "data": {"name": "Pull Day", "description": "Back and biceps", "exercises": [{"exercise_name": "Lat Pulldown", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 8}, {"set_number": 2, "set_type": "Working Set", "reps": 8}, {"set_number": 3, "set_type": "Working Set", "reps": 8}]}]}}, {"intent": "propose_workout_routine", "response": "**Day 3 — Leg Day**\\n\\n1. Squat — 3×8\\n2. Leg Press — 3×10\\n3. Calf Raises — 3×15", "data": {"name": "Leg Day", "description": "Quads, hamstrings, glutes", "exercises": [{"exercise_name": "Squat", "category": "strength", "sets": [{"set_number": 1, "set_type": "Working Set", "reps": 8}, {"set_number": 2, "set_type": "Working Set", "reps": 8}, {"set_number": 3, "set_type": "Working Set", "reps": 8}]}]}}]


Example JSON output for logging current weight:
{"intent": "log_measurement", "data": {"measurements": [{"type": "weight", "value": 72, "unit": "kg"}]}}


Be precise with data extraction and follow the JSON structure exactly.

**Special Instruction: Food Option Generation**
If you receive a request in the format "GENERATE_FOOD_OPTIONS:[food name] in [unit]", respond with a JSON array of 2-3 realistic \`FoodOption\` objects for the specified food name.
**Prioritize providing a \`serving_unit\` that matches the requested unit if it's a common and logical unit for that food.** If the requested unit is not common or logical for the food, provide a common and realistic serving unit (e.g., "g", "piece", "serving"). Each \`FoodOption\` should include:
- name: string (e.g., "\`Apple (medium)\`", "\`Cooked Rice (per cup)\`")
- calories: number (estimated)
- protein: number (estimated)
- carbs: number (estimated)
- fat: number (estimated)
- serving_size: number (e.g., 1, 100, 0.5) - This MUST be a numeric value representing the quantity.
- serving_unit: string (e.g., "\`piece\`", "\`g\`", "\`cup\`", "\`oz\`") - This MUST be the unit string only, without any numeric quantity.

Example JSON output for "GENERATE_FOOD_OPTIONS:apple":
[
  {"\`name\`": "\`Apple (medium)\`", "\`calories\`": 95, "\`protein\`": 0.5, "\`carbs\`": 25, "\`fat\`": 0.3, "\`serving_size\`": 1, "\`serving_unit\`": "\`piece\`"},
  {"\`name\`": "\`Apple (100g)\`", "\`calories\`": 52, "\`protein\`": 0.3, "\`carbs\`": 14, "\`fat\`": 0.2, "\`serving_size\`": 100, "\`serving_unit\`": "\`g\`"}
]
`;
    const messagesForAI = [{ role: 'system', content: systemPromptContent }];
    // Add user messages
    messagesForAI.push(...messages.filter((msg) => msg.role === 'user')); // Assuming 'messages' from frontend only contains user messages
    // For Google AI
    const cleanSystemPrompt = systemPromptContent
      .replace(/[^\w\s\-.,!?:;()[\]{}'"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 1000);
    switch (aiService.service_type) {
      case 'openai':
      case 'openai_compatible':
      case 'mistral':
      case 'groq':
      case 'openrouter':
      case 'custom':
        log(
          'debug',
          `[AI Service Request] Type: ${aiService.service_type}, URL: ${
            aiService.service_type === 'openai'
              ? 'https://api.openai.com/v1/chat/completions'
              : aiService.service_type === 'openai_compatible'
                ? `${aiService.custom_url}/chat/completions`
                : aiService.service_type === 'mistral'
                  ? 'https://api.mistral.ai/v1/chat/completions'
                  : aiService.service_type === 'groq'
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : aiService.service_type === 'openrouter'
                      ? 'https://openrouter.ai/api/v1/chat/completions'
                      : aiService.custom_url
          }, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch(
          aiService.service_type === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : aiService.service_type === 'openai_compatible'
              ? `${aiService.custom_url}/chat/completions`
              : aiService.service_type === 'mistral'
                ? 'https://api.mistral.ai/v1/chat/completions'
                : aiService.service_type === 'groq'
                  ? 'https://api.groq.com/openai/v1/chat/completions'
                  : aiService.service_type === 'openrouter'
                    ? 'https://openrouter.ai/api/v1/chat/completions'
                    : aiService.custom_url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(aiService.service_type === 'openrouter' && {
                'HTTP-Referer': 'https://sparky-fitness.com',
                'X-Title': 'Sparky Fitness',
              }),
              ...(aiService.api_key && {
                Authorization: `Bearer ${aiService.api_key}`,
              }),
            },
            body: JSON.stringify({
              model: model,
              messages: messagesForAI,
              temperature: 0.7,
            }),
          }
        );
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      case 'anthropic':
        log(
          'debug',
          `[AI Service Request] Type: Anthropic, URL: https://api.anthropic.com/v1/messages, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(aiService.api_key && { 'x-api-key': aiService.api_key }),
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 1000,
            messages: messagesForAI.filter((msg) => msg.role !== 'system'), // Anthropic system prompt is separate
            system: systemPromptContent,
          }),
        });
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      case 'google': {
        const googleBody = {
          contents: messagesForAI
            .map((msg) => {
              const role = msg.role === 'assistant' ? 'model' : 'user';
              let parts = [];
              if (typeof msg.content === 'string') {
                parts.push({ text: msg.content });
              } else if (Array.isArray(msg.content)) {
                parts = msg.content
                  // @ts-expect-error TS(2339): Property 'map' does not exist on type 'never'.
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((part: any) => {
                    if (part.type === 'text') {
                      return { text: part.text };
                    } else if (
                      part.type === 'image_url' &&
                      part.image_url?.url
                    ) {
                      try {
                        const urlParts = part.image_url.url.split(';base64,');
                        if (urlParts.length !== 2) {
                          log(
                            'error',
                            'Invalid data URL format for image part. Expected "data:[mimeType];base64,[data]".'
                          );
                          return null;
                        }
                        const mimeTypeMatch =
                          urlParts[0].match(/^data:(.*?)(;|$)/);
                        let mimeType = '';
                        if (mimeTypeMatch && mimeTypeMatch[1]) {
                          mimeType = mimeTypeMatch[1];
                        } else {
                          log(
                            'error',
                            'Could not extract mime type from data URL prefix:',
                            urlParts[0]
                          );
                          return null;
                        }
                        const base64Data = urlParts[1];
                        return {
                          inline_data: {
                            mime_type: mimeType,
                            data: base64Data,
                          },
                        };
                      } catch (e) {
                        log('error', 'Error processing image data URL:', e);
                        return null;
                      }
                    }
                    return null;
                  })
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .filter((part: any) => part !== null);
              }
              if (
                parts.length === 0 &&
                Array.isArray(msg.content) &&
                msg.content.some((part) => part.type === 'image_url')
              ) {
                parts.push({ text: '' });
              }
              return {
                parts: parts,
                role: role,
              };
            })
            .filter((content) => content.parts.length > 0),
        };
        if (googleBody.contents.length === 0) {
          throw new Error(
            'No valid content (text or image) found to send to Google AI.'
          );
        }
        if (cleanSystemPrompt && cleanSystemPrompt.length > 0) {
          // @ts-expect-error TS(2339): Property 'systemInstruction' does not exist on typ... Remove this comment to see the full error message
          googleBody.systemInstruction = {
            parts: [{ text: cleanSystemPrompt }],
          };
        }
        if (!aiService.api_key) {
          throw new Error('API key missing for Google AI service.');
        }
        log(
          'debug',
          `[AI Service Request] Type: Google, URL: https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=..., Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiService.api_key}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(googleBody),
          }
        );
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      }
      // For Ollama, extract only the text content from the last user message
      // and send it as a string. Ollama does not support multimodal input
      // in the same way as other providers.
      case 'ollama': {
        const ollamaMessages = messagesForAI.map((msg) => {
          let contentString = '';
          if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter(
              (part) => part.type === 'text'
            );
            if (textParts.length > 0) {
              contentString = textParts.map((part) => part.text).join(' ');
            }
            const imageParts = msg.content.filter(
              (part) => part.type === 'image_url'
            );
            if (imageParts.length > 0) {
              log(
                'warn',
                'Image data detected for Ollama service. Ollama does not support multimodal input in this format. Image data will be ignored.'
              );
            }
          } else if (typeof msg.content === 'string') {
            contentString = msg.content;
          }
          return { role: msg.role, content: contentString };
        });
        const timeout = aiService.timeout || 1200000; // Default to 1200 seconds (20 minutes)
        log('info', `Ollama chat request timeout set to ${timeout}ms`);
        // Create an undici Agent with the desired timeouts
        const ollamaAgent = new Agent({
          headersTimeout: timeout,
          bodyTimeout: timeout,
        });
        try {
          log(
            'debug',
            `[AI Service Request] Type: Ollama, URL: ${aiService.custom_url}/api/chat, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
          );
          response = await fetch(`${aiService.custom_url}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: model,
              messages: ollamaMessages,
              stream: false,
            }),
            // Pass the undici agent to the fetch call
            // @ts-expect-error TS(2769): No overload matches this call.
            dispatcher: ollamaAgent,
          });
        } catch (error) {
          // Translate undici timeouts into a clear timeout error
          if (
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            error.name === 'HeadersTimeoutError' ||
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            error.name === 'BodyTimeoutError'
          ) {
            throw new Error(
              `Ollama chat request timed out after ${timeout}ms due to undici timeout.`,
              { cause: error }
            );
          }
          // For network-level errors (ECONNREFUSED, ENOTFOUND, etc.) surface a 502-style error so the route returns JSON
          // Prefix with a recognizable token so the router can map to an appropriate HTTP status
          throw new Error(
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            `AI service API call error: 502 - Ollama fetch error: ${error.message}`,
            { cause: error }
          );
        } finally {
          // Destroy the agent to prevent resource leaks
          ollamaAgent.destroy();
        }
        break;
      }
      default: {
        const hasImage = messagesForAI.some(
          (msg) =>
            Array.isArray(msg.content) &&
            msg.content.some((part) => part.type === 'image_url')
        );
        if (hasImage) {
          throw new Error(
            `Image analysis is not supported for the selected AI service type: ${aiService.service_type}. Please select a multimodal model like Google Gemini in settings.`,
            { cause: { serviceType: aiService.service_type } }
          );
        }
        throw new Error(`Unsupported service type: ${aiService.service_type}`, {
          cause: { serviceType: aiService.service_type },
        });
      }
    }
    if (!response.ok) {
      const errorBody = await response.text();
      log(
        'error',
        `AI service API call error for ${aiService.service_type}. Status: ${response.status}, StatusText: ${response.statusText}, Content-Type: ${response.headers.get('content-type')}, Body: ${errorBody}`
      );
      throw new Error(
        `AI service API call error: ${response.status} - ${response.statusText}`
      );
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const errorBody = await response.text();
      log(
        'error',
        `AI service returned non-JSON response. Content-Type: ${contentType}, Body: ${errorBody}`
      );
      throw new Error(
        `AI service returned non-JSON response. Expected application/json but got ${contentType}. Raw Body: ${errorBody.substring(0, 200)}...`
      );
    }
    const data = await response.json();
    let content = '';
    switch (aiService.service_type) {
      case 'openai':
      case 'openai_compatible':
      case 'mistral':
      case 'groq':
      case 'openrouter':
      case 'custom':
        content =
          data.choices?.[0]?.message?.content || 'No response from AI service';
        break;
      case 'anthropic':
        content = data.content?.[0]?.text || 'No response from AI service';
        break;
      case 'google':
        content =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          'No response from AI service';
        break;
      case 'ollama':
        content = data.message?.content || 'No response from AI service';
        break;
    }
    return { content };
  } catch (error) {
    log(
      'error',
      `Error processing chat message for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function processFoodOptionsRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  foodName: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unit: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceConfigId: any
) {
  // Changed serviceConfig to serviceConfigId
  try {
    if (!serviceConfigId) {
      // Check if serviceConfigId is provided
      throw new Error('AI service configuration ID is missing.');
    }
    const aiService = await chatRepository.getAiServiceSettingForBackend(
      serviceConfigId,
      authenticatedUserId
    );
    if (!aiService) {
      throw new Error('AI service setting not found for the provided ID.');
    }
    // Log which source was used
    const source = aiService.source || 'unknown';
    log(
      'info',
      `Processing food options request for user ${authenticatedUserId} using AI service from ${source} (ID: ${serviceConfigId})`
    );
    // Ensure API key is present, unless it's Ollama
    if (aiService.service_type !== 'ollama' && !aiService.api_key) {
      throw new Error('API key missing for selected AI service.');
    }
    const systemPrompt = `You are Sparky, an AI nutrition and wellness coach. Your task is to generate minimum 3 realistic food options in JSON format when requested. Respond ONLY with a JSON array of FoodOption objects, including detailed nutritional information (calories, protein, carbs, fat, saturated_fat, polyunsaturated_fat, monounsaturated_fat, trans_fat, cholesterol, sodium, potassium, dietary_fiber, sugars, vitamin_a, vitamin_c, calcium, iron). **CRITICAL: Always provide estimated nutritional details for each food option. Do NOT default to 0 for any nutritional field if an estimation can be made.** Do NOT include any other text.
**CRITICAL: When a unit is specified in the request (e.g., 'GENERATE_FOOD_OPTIONS:apple in piece'), ensure the \`serving_unit\` in the generated \`FoodOption\` objects matches the requested unit exactly, if it's a common and logical unit for that food. If not, provide a common and realistic serving unit.**`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `GENERATE_FOOD_OPTIONS:${foodName} in ${unit}` },
    ];
    const model =
      aiService.model_name || getDefaultModel(aiService.service_type);
    let response;
    switch (aiService.service_type) {
      case 'openai':
      case 'openai_compatible':
      case 'mistral':
      case 'groq':
      case 'openrouter':
      case 'custom':
        log(
          'debug',
          `[AI Service Request] Type: ${aiService.service_type} (Food Options), URL: ${
            aiService.service_type === 'openai'
              ? 'https://api.openai.com/v1/chat/completions'
              : aiService.service_type === 'openai_compatible'
                ? `${aiService.custom_url}/chat/completions`
                : aiService.service_type === 'mistral'
                  ? 'https://api.mistral.ai/v1/chat/completions'
                  : aiService.service_type === 'groq'
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : aiService.service_type === 'openrouter'
                      ? 'https://openrouter.ai/api/v1/chat/completions'
                      : aiService.custom_url
          }, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch(
          aiService.service_type === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : aiService.service_type === 'openai_compatible'
              ? `${aiService.custom_url}/chat/completions`
              : aiService.service_type === 'mistral'
                ? 'https://api.mistral.ai/v1/chat/completions'
                : aiService.service_type === 'groq'
                  ? 'https://api.groq.com/openai/v1/chat/completions'
                  : aiService.service_type === 'openrouter'
                    ? 'https://openrouter.ai/api/v1/chat/completions'
                    : aiService.custom_url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(aiService.service_type === 'openrouter' && {
                'HTTP-Referer': 'https://sparky-fitness.com',
                'X-Title': 'Sparky Fitness',
              }),
              ...(aiService.api_key && {
                Authorization: `Bearer ${aiService.api_key}`,
              }),
            },
            body: JSON.stringify({
              model: model,
              messages: messages,
              temperature: 0.7,
            }),
          }
        );
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      case 'anthropic':
        log(
          'debug',
          `[AI Service Request] Type: Anthropic (Food Options), URL: https://api.anthropic.com/v1/messages, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(aiService.api_key && { 'x-api-key': aiService.api_key }),
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 1000,
            messages: messages.filter((msg) => msg.role !== 'system'), // Anthropic system prompt is separate
            system: systemPrompt,
          }),
        });
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      case 'google': {
        const googleBodyFoodOptions = {
          contents: messages
            .map((msg) => {
              const role = msg.role === 'assistant' ? 'model' : 'user';
              return {
                parts: [{ text: msg.content }],
                role: role,
              };
            })
            .filter((content) => content.parts[0].text.trim() !== ''),
        };
        if (googleBodyFoodOptions.contents.length === 0) {
          throw new Error('No valid content found to send to Google AI.');
        }
        const cleanSystemPromptFoodOptions = systemPrompt
          .replace(/[^\w\s\-.,!?:;()[\]{}'"]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 1000);
        if (
          cleanSystemPromptFoodOptions &&
          cleanSystemPromptFoodOptions.length > 0
        ) {
          // @ts-expect-error TS(2339): Property 'systemInstruction' does not exist on typ... Remove this comment to see the full error message
          googleBodyFoodOptions.systemInstruction = {
            parts: [{ text: cleanSystemPromptFoodOptions }],
          };
        }
        if (!aiService.api_key) {
          throw new Error('API key missing for Google AI service.');
        }
        log(
          'debug',
          `[AI Service Request] Type: Google (Food Options), URL: https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=..., Model: ${model}, API Key Provided: ${!!aiService.api_key}`
        );
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiService.api_key}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(googleBodyFoodOptions),
          }
        );
        if (!response) {
          throw new Error('Fetch did not return a response object.');
        }
        break;
      }
      // For Ollama, extract only the text content from the messages
      case 'ollama': {
        const ollamaMessagesFoodOptions = messages.map((msg) => {
          let contentString = '';
          if (Array.isArray(msg.content)) {
            const textParts = msg.content.filter(
              (part) => part.type === 'text'
            );
            if (textParts.length > 0) {
              contentString = textParts.map((part) => part.text).join(' ');
            }
          } else if (typeof msg.content === 'string') {
            contentString = msg.content;
          }
          return { role: msg.role, content: contentString };
        });
        const timeoutFoodOptions = aiService.timeout || 1200000; // Default to 1200 seconds (20 minutes)
        log(
          'info',
          `Ollama food options request timeout set to ${timeoutFoodOptions}ms`
        );
        // Create an undici Agent with the desired timeouts
        const ollamaAgentFoodOptions = new Agent({
          headersTimeout: timeoutFoodOptions,
          bodyTimeout: timeoutFoodOptions,
        });
        try {
          log(
            'debug',
            `[AI Service Request] Type: Ollama (Food Options), URL: ${aiService.custom_url}/api/chat, Model: ${model}, API Key Provided: ${!!aiService.api_key}`
          );
          response = await fetch(`${aiService.custom_url}/api/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: model,
              messages: ollamaMessagesFoodOptions,
              stream: false,
            }),
            // Pass the undici agent to the fetch call
            // @ts-expect-error TS(2769): No overload matches this call.
            dispatcher: ollamaAgentFoodOptions,
          });
        } catch (error) {
          if (
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            error.name === 'HeadersTimeoutError' ||
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            error.name === 'BodyTimeoutError'
          ) {
            throw new Error(
              `Ollama food options request timed out after ${timeoutFoodOptions}ms due to undici timeout.`,
              { cause: error }
            );
          }
          throw new Error(
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            `AI service API call error: 502 - Ollama fetch error: ${error.message}`,
            { cause: error }
          );
        } finally {
          // Destroy the agent to prevent resource leaks
          ollamaAgentFoodOptions.destroy();
        }
        break;
      }
      default:
        throw new Error(
          `Unsupported service type for food options generation: ${aiService.service_type}`
        );
    }
    if (!response.ok) {
      const errorBody = await response.text();
      log(
        'error',
        `AI service API call error for food options (${aiService.service_type}). Status: ${response.status}, StatusText: ${response.statusText}, Content-Type: ${response.headers.get('content-type')}, Body: ${errorBody}`
      );
      throw new Error(
        `AI service API call error: ${response.status} - ${response.statusText}`
      );
    }
    const contentTypeFoodOptions = response.headers.get('content-type');
    if (
      !contentTypeFoodOptions ||
      !contentTypeFoodOptions.includes('application/json')
    ) {
      const errorBody = await response.text();
      log(
        'error',
        `AI service returned non-JSON response for food options. Content-Type: ${contentTypeFoodOptions}, Body: ${errorBody}`
      );
      throw new Error(
        `AI service returned non-JSON response for food options. Expected application/json but got ${contentTypeFoodOptions}. Raw Body: ${errorBody.substring(0, 200)}...`
      );
    }
    const data = await response.json();
    let content = '';
    switch (aiService.service_type) {
      case 'openai':
      case 'openai_compatible':
      case 'mistral':
      case 'groq':
      case 'openrouter':
      case 'custom':
        content =
          data.choices?.[0]?.message?.content || 'No response from AI service';
        break;
      case 'anthropic':
        content = data.content?.[0]?.text || 'No response from AI service';
        break;
      case 'google':
        content =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          'No response from AI service';
        break;
      case 'ollama':
        content = data.message?.content || 'No response from AI service';
        break;
    }
    return { content };
  } catch (error) {
    log(
      'error',
      `Error processing food options request for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
export { handleAiServiceSettings };
export { getAiServiceSettings };
export { getActiveAiServiceSetting };
export { deleteAiServiceSetting };
export { clearOldChatHistory };
export { getSparkyChatHistory };
export { getSparkyChatHistoryEntry };
export { updateSparkyChatHistoryEntry };
export { deleteSparkyChatHistoryEntry };
export { clearAllSparkyChatHistory };
export { saveSparkyChatHistory };
export { processChatMessage };
export { processFoodOptionsRequest };
export default {
  handleAiServiceSettings,
  getAiServiceSettings,
  getActiveAiServiceSetting,
  deleteAiServiceSetting,
  clearOldChatHistory,
  getSparkyChatHistory,
  getSparkyChatHistoryEntry,
  updateSparkyChatHistoryEntry,
  deleteSparkyChatHistoryEntry,
  clearAllSparkyChatHistory,
  saveSparkyChatHistory,
  processChatMessage,
  processFoodOptionsRequest,
};
