import type { PlatformAdapter } from '../types';
import { classify, httpJson, publishedUrlOrNull, truncate } from '../http';

const GQL = 'https://gql.hashnode.com';

const ME_QUERY = `query Me {
  me {
    username
    name
    publications(first: 20) { edges { node { id title url } } }
  }
}`;

const PUBLISH_MUTATION = `mutation PublishPost($input: PublishPostInput!) {
  publishPost(input: $input) { post { id slug url title } }
}`;

export const hashnode: PlatformAdapter = {
  id: 'hashnode',
  name: 'Hashnode',
  group: 'A',
  automation: 'approval',
  integration: 'Hashnode GraphQL API',
  docsUrl: 'https://apidocs.hashnode.com/',
  notes:
    'Hashnode publishing is available through its GraphQL API, but API publishing has been gated behind plan/approval changes. The adapter verifies your token and returns the exact API error if your account is not enabled — it never fakes a post.',
  connectInstructions:
    'Hashnode → Account settings → Developer → Personal Access Token. Copy the token and your publication host (e.g. yourblog.hashnode.dev).',
  permissionNotes: 'Token needs publish rights on the publication. If your plan does not include API publishing, Hashnode returns an authorization error which is shown verbatim.',
  credentialFields: [
    { key: 'apiToken', label: 'Personal access token', type: 'password', required: true },
    { key: 'publicationId', label: 'Publication ID (optional)', type: 'text', required: false, help: 'Find it in the publication dashboard URL, or leave blank to auto-detect.' },
  ],
  capabilities: { text: true, image: true, video: false, article: true, imageViaUrl: true },
  async verify({ credentials }) {
    const res = await httpJson<{ data?: { me?: { username?: string; name?: string; publications?: { edges: { node: { id: string; title: string; url: string } }[] } } }; errors?: { message: string }[] }>(
      GQL,
      { method: 'POST', headers: { authorization: credentials.apiToken }, body: { query: ME_QUERY } }
    );
    if (!res.ok || res.data?.errors?.length) {
      const detail = res.data?.errors?.[0]?.message ?? classify(res, 'Hashnode verification').message;
      return { ok: false, detail };
    }
    const me = res.data?.data?.me;
    const pubs = me?.publications?.edges?.map((e) => e.node) ?? [];
    if (!pubs.length) return { ok: false, detail: 'This Hashnode account has no publication to publish to.' };
    const chosen = credentials.publicationId ? pubs.find((p) => p.id === credentials.publicationId) ?? pubs[0] : pubs[0];
    return {
      ok: true,
      accountName: chosen.title,
      externalId: chosen.id,
      meta: { publicationId: chosen.id, publicationUrl: chosen.url, publications: pubs },
    };
  },
  async publish({ account, content, media, business, log }) {
    const publicationId = account.credentials.publicationId || (account.meta.publicationId as string | undefined);
    if (!publicationId) return { ok: false, error: 'No Hashnode publication selected.', errorCode: 'missing_publication', retryable: false };
    const image = media.find((m) => m.kind === 'image');
    if (image && !image.publicUrl) log('media', 'No public media URL configured — publishing without a cover image.');

    const markdown = [
      content.description || content.caption,
      content.destinationUrl ? `\n\n---\n\n[${content.cta || 'Visit website'}](${content.destinationUrl})` : '',
    ].join('\n');

    const tags = content.hashtags.slice(0, 5).map((t) => ({
      name: t.replace(/^#/, '').replace(/-/g, ' '),
      slug: t.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    }));

    const res = await httpJson<{
      data?: { publishPost?: { post?: { id?: string; url?: string; slug?: string } } };
      errors?: { message: string }[];
    }>(GQL, {
      method: 'POST',
      headers: { authorization: account.credentials.apiToken },
      body: {
        query: PUBLISH_MUTATION,
        variables: {
          input: {
            title: truncate(content.title || content.caption, 120),
            publicationId,
            contentMarkdown: markdown,
            tags,
            coverImageOptions: image?.publicUrl ? { coverImageURL: image.publicUrl } : undefined,
            originalArticleURL: content.destinationUrl || undefined,
          },
        },
      },
    });
    if (!res.ok || res.data?.errors?.length) {
      const c = classify(res, 'Hashnode publish');
      return {
        ok: false,
        error: res.data?.errors?.[0]?.message ?? c.message,
        errorCode: res.data?.errors?.length ? 'api_rejected' : c.code,
        retryable: false,
      };
    }
    const post = res.data?.data?.publishPost?.post;
    return { ok: true, externalId: post?.id, url: publishedUrlOrNull(post?.url) };
  },
  contentHint:
    'Educational website-development guide for Hashnode (500-900 words) with markdown sections. Practical, no hype, business mentioned only in a closing paragraph.',
  limits: { caption: 8000, title: 120, hashtags: 5 },
};
