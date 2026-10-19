export type ProviderResult = { data?: { id?: string } | null; error?: { message?: string } | null };

export function requireAcceptedId(result: ProviderResult): string {
  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message || 'Provider did not return an acceptance ID');
  }
  return result.data.id;
}
