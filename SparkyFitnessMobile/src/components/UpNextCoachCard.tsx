import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import Icon from './Icon';
import { withAlpha } from '../utils/colors';

/**
 * How much of the paragraph survives a collapse. Two lines is enough for the
 * muscles it names — the part that answers "why this workout" at a glance —
 * while the goal and any dropped-muscle sentence fold away.
 */
const COLLAPSED_LINES = 2;

/** Tint strength for the card's fill; the same one the set cursor pill uses. */
const CARD_TINT_ALPHA = 0.12;

interface UpNextCoachCardProps {
  /**
   * The engine's paragraph, served on the recommendation payload. Server
   * English, rendered verbatim like the per-exercise rationale beside it — it
   * is generated text, not an application label, so it is not translated.
   */
  rationale: string;
}

/**
 * Why this workout, above the exercises that answer it.
 *
 * The engine already explains every row ("fresh quads · +2.5% from last
 * session"); what it could not say until now is why the session as a whole
 * looks like this. This is that, in an accent-tinted card so it reads as the
 * coach talking rather than as more of the header.
 *
 * Collapsible, and expanded by default: it is two or three sentences, the
 * user asked for none of them, and a reader who does not want it should be
 * able to fold it away — but a card that hid itself on first open would never
 * be found. The state is deliberately not persisted; the paragraph changes
 * with every regenerate, so a collapse remembered from a different workout
 * would be answering a question the user never asked about this one.
 */
function UpNextCoachCard({ rationale }: UpNextCoachCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [accentPrimary, accentMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-accent-muted',
  ]) as [string, string];

  if (rationale.trim().length === 0) return null;

  return (
    <Pressable
      testID="up-next-coach-card"
      onPress={() => setExpanded((value) => !value)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={t('upNext.coachNote', {
        defaultValue: 'Coach note: {{note}}',
        note: rationale,
      })}
      accessibilityHint={
        expanded
          ? t('upNext.coachCollapse', { defaultValue: 'Collapses the note' })
          : t('upNext.coachExpand', { defaultValue: 'Shows the whole note' })
      }
      className="mt-3.5 px-3.5 py-3"
      style={{
        borderRadius: 14,
        backgroundColor: withAlpha(accentPrimary, CARD_TINT_ALPHA),
      }}
    >
      <View className="flex-row items-start" style={{ gap: 10 }}>
        <Text
          // Not `accessible` in its own right: the card is one element and
          // already speaks the whole note, so a focusable child would read it
          // out twice.
          className="flex-1 text-text-primary"
          style={{ fontSize: 14, lineHeight: 20 }}
          numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        >
          {rationale}
        </Text>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={accentMuted}
        />
      </View>
      <Text
        className="font-semibold uppercase"
        style={{
          fontSize: 11,
          lineHeight: 14,
          marginTop: 8,
          letterSpacing: 0.44,
          color: accentMuted,
        }}
      >
        {t('upNext.coachLabel', { defaultValue: 'Coach' })}
      </Text>
    </Pressable>
  );
}

export default React.memo(UpNextCoachCard);
