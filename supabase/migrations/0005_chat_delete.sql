-- my-ai-coach — autorise la suppression de ses propres messages (édition/régénération du chat).
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (user_id = auth.uid());
