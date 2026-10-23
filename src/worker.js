// We the People 305 public Worker: the holding page at wethepeople305.org and the open planning docs at /docs.
// The founder board is a separate private Worker on admin.wethepeople305.org and is not in this repo.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);
  }
};
