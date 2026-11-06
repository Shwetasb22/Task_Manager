-- Give people access. Step 1: create each user in Supabase → Authentication → Users → "Add user"
-- (email = their Outlook ID, set a temporary password, tick "Auto Confirm User").
-- Step 2: edit the emails/names below and run this in the SQL editor. Re-runnable any time.
-- manager_name must match the tracker's manager exactly (tasks.manager); owner_name must match
-- the Owner column spelling exactly (tasks.owner).

-- Admins: both people can open the full Teams list and inspect any tracker/person.
update public.profiles set role = 'admin',     name = 'Naveen Sahni'  where lower(email) = 'naveen.sahni@bremboindia.com';
update public.profiles set role = 'admin', name = 'Vishal Shinde', can_edit_owner_names = true where lower(email) = 'vishal.shinde@bremboindia.com';

-- Managers: each sees only their own tracker
update public.profiles set role = 'manager', name = 'Sagar Ingle',    manager_name = 'Sagar Ingle' where email = 'sagar.ingle@bremboindia.com';
-- update public.profiles set role = 'manager', name = 'Abhijit Mendki', manager_name = 'Abhijit Mendki' where email = 'abhijit@yourcompany.com';

-- Owners (optional): see only the actions assigned to them and can attach proof
-- update public.profiles set role = 'owner', name = 'Veeru', owner_name = 'Veeru' where email = 'veeru@yourcompany.com';

-- Check the result
select email, name, role, manager_name, owner_name from public.profiles order by role, email;

-- ───────────── Owner name matching (migration 0014) ─────────────
-- Owners see every issue whose Owner cell contains one of their aliases (full name, reversed name,
-- first name, and close tracker spellings are added automatically). To check or fix one owner:
--   select email, name, owner_aliases from public.profiles where role = 'owner' order by email;
--   update public.profiles set owner_aliases = array_append(owner_aliases, 'yogita s')
--   where email = 'yogita.salunkhe@bremboindia.com';
-- If two owners share a first name and one should NOT see first-name-only issues, remove it:
--   update public.profiles set owner_aliases = array_remove(owner_aliases, 'vishal')
--   where email = 'vishal.pawar@bremboindia.com';
