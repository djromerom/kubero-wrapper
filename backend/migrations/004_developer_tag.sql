ALTER TABLE users ALTER COLUMN role SET DEFAULT 'developer';

UPDATE users SET role = 'developer' WHERE role = 'student';
