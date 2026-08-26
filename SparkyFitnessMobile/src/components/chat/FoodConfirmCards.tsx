import { useTranslation } from 'react-i18next';
import { Text, Pressable, View } from 'react-native';
import type { ToolCallMessagePart } from '@assistant-ui/react-native';
import { useAui, useAuiState } from '@assistant-ui/react-native';
import {
  CONFIRM_FOOD_REJECT_MESSAGE,
  MIN_FOOD_CANDIDATES,
  confirmFoodPickMessage,
  type ConfirmFoodInput,
  type FoodCandidate,
} from '@workspace/shared';

/** Human label for a candidate's source badge. */
function sourceLabel(source: string): string {
  if (source === 'internal') return 'Your foods';
  if (source === 'ai_estimate') return 'AI estimate';
  return source;
}

/** "P 2g · C 24g · F 3g" — only the macros the candidate actually carries. */
function macroLine(c: FoodCandidate): string {
  return [
    typeof c.protein === 'number' ? `P ${c.protein}g` : null,
    typeof c.carbs === 'number' ? `C ${c.carbs}g` : null,
    typeof c.fat === 'number' ? `F ${c.fat}g` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Renders the `sparky_confirm_food` tool call as tappable candidate cards —
 * the "which food did you actually mean" confirmation with the nutrition
 * details plain quick-reply chips can't show. Mirrors the web's
 * FoodConfirmToolUI.
 *
 * Tapping a card sends the shared pick message as an ordinary user message;
 * the server replays the candidates (ids included) as text, so the model logs
 * the pick without a fresh lookup. See
 * @workspace/shared/constants/chatFoodConfirm.
 */
export default function FoodConfirmCards({ part }: { part: ToolCallMessagePart }) {
  const { t } = useTranslation();
  const aui = useAui();
  const isLast = useAuiState((s) => s.message.isLast);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  const args = part.args as Partial<ConfirmFoodInput> | undefined;
  // The tool input streams in as partial JSON — render nothing until at least
  // one candidate is complete enough to be a card.
  const candidates = (Array.isArray(args?.candidates) ? args.candidates : []).filter(
    (c): c is FoodCandidate => !!c?.label && c?.calories !== undefined,
  );
  if (candidates.length < MIN_FOOD_CANDIDATES) return null;

  // Cards on an older message would confirm a stale question the chat has
  // moved past, so they only stay live on the final message.
  const disabled = !isLast || isRunning;

  return (
    <View className="my-1 gap-2">
      {typeof args?.question === 'string' && args.question.length > 0 && (
        <Text className="text-text-secondary text-sm">{args.question}</Text>
      )}
      {candidates.map((candidate, i) => {
        const macros = macroLine(candidate);
        return (
          <Pressable
            key={`${candidate.label}-${i}`}
            disabled={disabled}
            onPress={() => aui.thread().append(confirmFoodPickMessage(i + 1, candidate))}
            className={`bg-background border border-border-subtle rounded-xl px-3 py-2 gap-0.5 ${disabled ? 'opacity-50' : ''}`}
          >
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-text-primary text-sm font-medium shrink">
                {candidate.label}
              </Text>
              {!!candidate.brand && (
                <Text className="text-text-muted text-sm shrink">{candidate.brand}</Text>
              )}
              <View className="ml-auto border border-border-subtle rounded-full px-2 py-0.5">
                <Text className="text-text-secondary text-xs">
                  {sourceLabel(candidate.source)}
                </Text>
              </View>
            </View>
            <Text className="text-text-muted text-xs">
              {t('foodConfirm.caloriesPerServing', {
                defaultValue: '{{calories}} Cal per {{size}} {{unit}}',
                calories: candidate.calories,
                size: candidate.serving_size,
                unit: candidate.serving_unit,
              })}
              {macros ? ` · ${macros}` : ''}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        disabled={disabled}
        onPress={() => aui.thread().append(CONFIRM_FOOD_REJECT_MESSAGE)}
        className={`self-start px-1 py-1 ${disabled ? 'opacity-50' : ''}`}
      >
        <Text className="text-text-muted text-sm">
          {t('foodConfirm.noneOfThese', { defaultValue: 'None of these' })}
        </Text>
      </Pressable>
    </View>
  );
}
