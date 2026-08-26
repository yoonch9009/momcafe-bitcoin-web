-- Final report datasets projected from reports/analysis-results.json and reports/spike-top-risk-results.json.
-- The upstream calculations are reproduced by reports/analyze-momcafe-results.mjs and reports/analyze-spike-top-risk.mjs.
SELECT * FROM "headline";
SELECT * FROM "spike_risk_headline";
SELECT * FROM "spike_risk_comparison";
SELECT * FROM "extreme_spike_events";
SELECT * FROM "extreme_spike_sensitivity";
SELECT * FROM "mention_distribution";
SELECT * FROM "correlations";
SELECT * FROM "attention_buckets";
SELECT * FROM "lead_lag";
SELECT * FROM "recent_lead_lag";
SELECT * FROM "events";
SELECT * FROM "recent_events";
SELECT * FROM "full_events";
SELECT * FROM "rolling_3y";
SELECT * FROM "regimes";
SELECT * FROM "recent_regimes";
SELECT * FROM "granger";
SELECT * FROM "quality";
