INSERT INTO warehouses (code, name, type, is_active)
VALUES ('repair', '送修倉', 'repair', true)
ON CONFLICT (code) DO NOTHING;
