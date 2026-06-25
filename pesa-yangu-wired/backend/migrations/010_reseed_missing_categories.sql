-- Re-seed default categories for any user who currently has none
-- (e.g. users who hit the data-reset before the fix that auto-reseeds)

DO $$
DECLARE
  uid UUID;
BEGIN
  FOR uid IN
    SELECT id FROM users
    WHERE NOT EXISTS (SELECT 1 FROM categories WHERE user_id = users.id)
  LOOP
    -- Expense categories
    INSERT INTO categories (user_id, name, type, icon, color, budget_kes, watch, is_system, sort_order) VALUES
      (uid, 'Rent / Mortgage',  'expense', '🏠', '#4A90E2', 25000, true,  false, 0),
      (uid, 'Food & Dining',    'expense', '🍔', '#F5A623', 15000, true,  false, 1),
      (uid, 'Transport',        'expense', '🚗', '#7ED321', 8000,  false, false, 2),
      (uid, 'Utilities',        'expense', '⚡', '#9B59B6', 5000,  false, false, 3),
      (uid, 'Entertainment',    'expense', '🎬', '#E74C3C', 4000,  false, false, 4),
      (uid, 'Health',           'expense', '💊', '#1ABC9C', 5000,  false, false, 5),
      (uid, 'Shopping',         'expense', '🛍️', '#E67E22', 8000,  false, false, 6),
      (uid, 'Education',        'expense', '📚', '#3498DB', 3000,  false, false, 7),
      (uid, 'Subscriptions',    'expense', '🔁', '#8E44AD', 2000,  false, false, 8),
      (uid, 'Loan Repayment',   'expense', '🏦', '#E74C3C', 0,     false, true,  9)
    ON CONFLICT (user_id, name, type) DO NOTHING;

    -- Income categories
    INSERT INTO categories (user_id, name, type, icon, color, budget_kes, sort_order) VALUES
      (uid, 'Salary',            'income', '💼', '#00D4AA', 0, 10),
      (uid, 'Freelance',         'income', '💻', '#4A90E2', 0, 11),
      (uid, 'Investment Return', 'income', '📈', '#F5C842', 0, 12),
      (uid, 'Interest',          'income', '🏦', '#2ECC71', 0, 13),
      (uid, 'Dividend',          'income', '💹', '#E67E22', 0, 14),
      (uid, 'Rental Income',     'income', '🏠', '#9B59B6', 0, 15),
      (uid, 'Other Income',      'income', '💵', '#2ECC71', 0, 16)
    ON CONFLICT (user_id, name, type) DO NOTHING;
  END LOOP;
END;
$$;
