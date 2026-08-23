import { Text, Pressable, View } from 'react-native';
import type { ToolCallMessagePart } from '@assistant-ui/react-native';
import { useAui, useAuiState } from '@assistant-ui/react-native';
import { MIN_ASK_USER_OPTIONS, type AskUserInput } from '@workspace/shared';

/**
 * Renders the `sparky_ask_user` tool call as tappable quick-reply chips —
 * mobile parity for the web's AskUserToolUI.
 *
 * Tapping a chip sends its text as an ordinary user message, so the model sees
 * a normal reply ("75g each") rather than a special event — no client-side
 * tool result is needed, and typing the answer by hand behaves identically.
 * The question is always asked BEFORE the action, so nothing has been logged
 * yet when these chips appear. See @workspace/shared/constants/chatAskUser.
 */
export default function AskUserChips({ part }: { part: ToolCallMessagePart }) {
  const aui = useAui();
  const isLast = useAuiState((s) => s.message.isLast);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  const args = part.args as Partial<AskUserInput> | undefined;
  // The tool input streams in as partial JSON, so `options` is briefly absent
  // or half-built. Rendering it early flashes a one-item or empty chip row.
  const options = Array.isArray(args?.options)
    ? args.options.filter((o): o is string => typeof o === 'string')
    : [];
  if (options.length < MIN_ASK_USER_OPTIONS) return null;

  // Chips on an older message would re-send a stale answer to a question that
  // has already moved on, so they only stay live on the final message.
  const disabled = !isLast || isRunning;

  return (
    <View className="my-1 gap-2">
      {typeof args?.question === 'string' && args.question.length > 0 && (
        <Text className="text-text-secondary text-sm">{args.question}</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Pressable
            key={option}
            disabled={disabled}
            onPress={() => aui.thread().append(option)}
            className={`bg-background border border-border-subtle rounded-3xl px-3 py-1.5 ${disabled ? 'opacity-50' : ''}`}
          >
            <Text className="text-text-primary text-sm font-medium">{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
