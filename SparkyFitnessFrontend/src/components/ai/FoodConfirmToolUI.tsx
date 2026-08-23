import {
  useMessage,
  useThread,
  useThreadRuntime,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { useTranslation } from 'react-i18next';
import {
  CONFIRM_FOOD_REJECT_MESSAGE,
  MIN_FOOD_CANDIDATES,
  confirmFoodPickMessage,
  type ConfirmFoodInput,
  type FoodCandidate,
} from '@workspace/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
 * the "which food did you actually mean" confirmation the quick-reply chips
 * can't express (they carry no nutrition details).
 *
 * Tapping a card sends the shared pick message as an ordinary user message;
 * the server replays the candidates (ids included) as text, so the model logs
 * the pick without a fresh lookup. See
 * @workspace/shared/constants/chatFoodConfirm.
 */
export const FoodConfirmToolUI: ToolCallMessagePartComponent<
  ConfirmFoodInput
> = ({ args }) => {
  const { t } = useTranslation();
  const threadRuntime = useThreadRuntime();
  const isLast = useMessage((m) => m.isLast);
  const isRunning = useThread((th) => th.isRunning);

  // The tool input streams in as partial JSON — render nothing until at least
  // one candidate is complete enough to be a card.
  const candidates = (
    Array.isArray(args?.candidates) ? args.candidates : []
  ).filter((c): c is FoodCandidate => !!c?.label && c?.calories !== undefined);
  if (candidates.length < MIN_FOOD_CANDIDATES) return null;

  // Cards on an older message would confirm a stale question the chat has
  // moved past, so they only stay live on the final message.
  const disabled = !isLast || isRunning;

  const send = (text: string) => {
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  };

  return (
    <div className="aui-food-confirm-root my-2 flex flex-col gap-2">
      {args?.question && (
        <p className="aui-food-confirm-question text-muted-foreground text-sm">
          {args.question}
        </p>
      )}
      <div className="aui-food-confirm-options flex flex-col gap-2">
        {candidates.map((candidate, i) => {
          const macros = macroLine(candidate);
          return (
            <Button
              key={`${candidate.label}-${i}`}
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => send(confirmFoodPickMessage(i + 1, candidate))}
              className={cn(
                'aui-food-confirm-option bg-background hover:bg-muted h-auto flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm font-normal whitespace-normal transition-colors',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              <span className="flex w-full flex-wrap items-center gap-2">
                <span className="font-medium">{candidate.label}</span>
                {candidate.brand && (
                  <span className="text-muted-foreground">
                    {candidate.brand}
                  </span>
                )}
                <Badge variant="outline" className="ml-auto">
                  {sourceLabel(candidate.source)}
                </Badge>
              </span>
              <span className="text-muted-foreground text-xs">
                {t('foodConfirm.servingLine', {
                  defaultValue: '{{calories}} Cal per {{size}} {{unit}}',
                  calories: candidate.calories,
                  size: candidate.serving_size,
                  unit: candidate.serving_unit,
                })}
                {macros && ` · ${macros}`}
              </span>
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => send(CONFIRM_FOOD_REJECT_MESSAGE)}
          className={cn(
            'aui-food-confirm-reject text-muted-foreground self-start',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          {t('foodConfirm.noneOfThese', 'None of these')}
        </Button>
      </div>
    </div>
  );
};
