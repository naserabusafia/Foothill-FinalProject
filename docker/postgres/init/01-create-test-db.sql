-- Runs once, when the data volume is first created.
-- Integration tests use a separate database so they can truncate freely.
CREATE DATABASE quota_test;
