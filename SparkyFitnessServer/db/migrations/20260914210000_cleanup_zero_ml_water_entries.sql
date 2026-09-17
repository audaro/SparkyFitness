-- Clean up zero or negative water intake entries logged by external sync providers
DELETE FROM public.water_intake_entries
WHERE water_ml <= 0 AND source != 'manual';

DELETE FROM public.water_intake
WHERE water_ml <= 0 AND source != 'manual';
