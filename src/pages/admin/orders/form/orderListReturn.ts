export function listReturnTo(search?: string | URLSearchParams | undefined): string {
  const params = new URLSearchParams();
  const src = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? '');

  for (const [key, value] of src.entries()) {
    if (!value) continue;
    if (key === 'type' || key === 'p' || key === 'category' || key === 'brands' || key === 'specs') {
      continue;
    }
    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/admin/orders?${query}` : '/admin/orders';
}
