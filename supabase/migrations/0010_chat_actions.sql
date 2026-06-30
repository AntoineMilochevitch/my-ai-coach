-- =====================================================================
-- my-ai-coach — 0010 : actions confirmables dans le chat.
--  * chat_messages.action : proposition d'action structurée attachée à un
--    message du coach (kind, args, summary, status). L'utilisateur confirme ou
--    annule depuis la conversation.
--  * Policy UPDATE self : permet de marquer une action appliquée/annulée.
-- =====================================================================
alter table public.chat_messages
  add column if not exists action jsonb;

drop policy if exists "chat_messages_update_own" on public.chat_messages;
create policy "chat_messages_update_own" on public.chat_messages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
