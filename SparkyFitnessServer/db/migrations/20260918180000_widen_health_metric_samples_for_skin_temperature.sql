-- Widen chk_health_metric_samples_metric to include 'skin_temperature'
ALTER TABLE health_metric_samples
    DROP CONSTRAINT IF EXISTS chk_health_metric_samples_metric;

ALTER TABLE health_metric_samples
    ADD CONSTRAINT chk_health_metric_samples_metric CHECK (metric IN (
        'heart_rate', 'hrv', 'respiration', 'spo2', 'stress', 'body_battery', 'skin_temperature'
    ));
