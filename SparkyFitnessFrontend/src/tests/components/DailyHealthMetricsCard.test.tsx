import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DailyHealthMetrics } from '@workspace/shared';
import { DailyHealthMetricsCard } from '@/components/Health/DailyHealthMetricsCard';

// The card calls t(key, defaultValue, options); interpolate so assertions can
// check the rendered value rather than the raw {{val}} template.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: unknown) => {
      const opts = (
        typeof defaultValue === 'object' && defaultValue !== null
          ? defaultValue
          : options
      ) as Record<string, unknown> | undefined;
      const template =
        typeof defaultValue === 'string'
          ? defaultValue
          : ((opts?.['defaultValue'] as string) ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) =>
        String(opts?.[name] ?? '')
      );
    },
  }),
}));

const metrics = (overrides: Partial<DailyHealthMetrics>): DailyHealthMetrics =>
  ({
    source_provider: 'polar',
    body_battery_highest: null,
    body_battery_lowest: null,
    body_battery_charged: null,
    body_battery_drained: null,
    avg_stress_level: null,
    max_stress_level: null,
    resting_heart_rate: null,
    heart_rate_recovery_1min: null,
    vo2_max: null,
    fitness_age: null,
    training_readiness_score: null,
    recovery_time_hours: null,
    acute_training_load: null,
    chronic_training_load: null,
    weekly_training_load: null,
    acwr_ratio: null,
    ...overrides,
  }) as DailyHealthMetrics;

describe('DailyHealthMetricsCard section visibility', () => {
  // Polar reports a resting HR but no body battery, stress, VO2 max or
  // readiness. Those tiles used to render as a wall of "--" (issue #2471).
  it('renders only the tiles the provider actually reported', () => {
    render(
      <DailyHealthMetricsCard metrics={metrics({ resting_heart_rate: 54 })} />
    );

    expect(screen.getByText('Resting HR')).toBeInTheDocument();
    expect(screen.getByText('54')).toBeInTheDocument();

    expect(screen.queryByText('Body Battery')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg Stress')).not.toBeInTheDocument();
    expect(screen.queryByText('VO2 Max')).not.toBeInTheDocument();
    expect(screen.queryByText('Readiness')).not.toBeInTheDocument();
    expect(screen.queryByText('Training Load')).not.toBeInTheDocument();
  });

  it('renders Training Load tile when acute training load is present', () => {
    render(
      <DailyHealthMetricsCard
        metrics={metrics({
          acute_training_load: 45.2,
          chronic_training_load: 38.5,
          acwr_ratio: 1.17,
        })}
      />
    );

    expect(screen.getByText('Training Load')).toBeInTheDocument();
    expect(screen.getByText('45.2')).toBeInTheDocument();
    expect(screen.getByText('Ratio: 1.17')).toBeInTheDocument();
  });

  it('renders every tile when a provider reports everything', () => {
    render(
      <DailyHealthMetricsCard
        metrics={metrics({
          source_provider: 'garmin',
          body_battery_highest: 80,
          avg_stress_level: 30,
          resting_heart_rate: 48,
          vo2_max: 47,
          training_readiness_score: 72,
          acute_training_load: 50,
        })}
      />
    );

    [
      'Body Battery',
      'Avg Stress',
      'Resting HR',
      'VO2 Max',
      'Readiness',
      'Training Load',
    ].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });

  it('treats a zero reading as real data, not a missing tile', () => {
    render(
      <DailyHealthMetricsCard
        metrics={metrics({ body_battery_highest: 0, avg_stress_level: 0 })}
      />
    );

    expect(screen.getByText('Body Battery')).toBeInTheDocument();
    expect(screen.getByText('Avg Stress')).toBeInTheDocument();
  });

  it('renders zero-valued recovery readings instead of dashes', () => {
    render(
      <DailyHealthMetricsCard
        metrics={metrics({
          resting_heart_rate: 54,
          heart_rate_recovery_1min: 0,
          training_readiness_score: 60,
          recovery_time_hours: 0,
        })}
      />
    );

    expect(screen.getByText('Recovery: 0 bpm')).toBeInTheDocument();
    expect(screen.getByText(/Rec: 0h/)).toBeInTheDocument();
  });

  it('reports an empty day rather than collapsing the tile', () => {
    // The Diary grid is user-arranged and persistent: the card stays put and
    // says the day has no sync, instead of vanishing and reflowing the layout.
    render(<DailyHealthMetricsCard />);

    expect(
      screen.getByText('No wearable data synced for this day.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Daily Wearable Health Summary')
    ).toBeInTheDocument();
  });
});
