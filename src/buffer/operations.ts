// Every GraphQL operation Still True sends to Buffer. The test suite validates each document against
// schema/buffer.graphql, the introspected schema of https://api.buffer.com, so a renamed field fails CI.

const POST_FIELDS = /* GraphQL */ `
  fragment CheckedPost on Post {
    id
    text
    status
    dueAt
    createdAt
    updatedAt
    channelId
    channelService
    via
    isCustomScheduled
    shareMode
    schedulingType
    author {
      name
      urn
    }
    tags {
      id
      name
    }
    metadata {
      __typename
      ... on InstagramPostMetadata {
        link
      }
      ... on FacebookPostMetadata {
        linkAttachment {
          url
        }
      }
      ... on LinkedInPostMetadata {
        linkAttachment {
          url
        }
      }
      ... on BlueskyPostMetadata {
        linkAttachment {
          url
        }
      }
      ... on ThreadsPostMetadata {
        linkAttachment {
          url
        }
      }
    }
  }
`;

export const ACCOUNT = /* GraphQL */ `
  query Account {
    account {
      id
      name
      timezone
      organizations {
        id
        name
        channelCount
        limits {
          scheduledPosts
        }
      }
    }
  }
`;

export const CHANNELS = /* GraphQL */ `
  query Channels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      avatar
      timezone
      isDisconnected
      isQueuePaused
      isLocked
    }
  }
`;

export const QUEUE = /* GraphQL */ `
  query Queue(
    $organizationId: OrganizationId!
    $status: [PostStatus!]
    $start: DateTime
    $end: DateTime
    $after: String
  ) {
    posts(
      first: 100
      after: $after
      input: {
        organizationId: $organizationId
        filter: { status: $status, dueAt: { start: $start, end: $end } }
        sort: [{ field: dueAt, direction: asc }]
      }
    ) {
      edges {
        node {
          ...CheckedPost
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
  ${POST_FIELDS}
`;

export const POST = /* GraphQL */ `
  query Post($id: PostId!) {
    post(input: { id: $id }) {
      ...CheckedPost
    }
  }
  ${POST_FIELDS}
`;

const POST_ACTION_RESULT = /* GraphQL */ `
  __typename
  ... on PostActionSuccess {
    post {
      id
      status
      dueAt
      text
    }
  }
  ... on MutationError {
    message
  }
`;

// Buffer refuses an editPost without `text` ("Post must have either text or media"), so every edit
// below sends the post's current text with it.

/** Moves a scheduled post to drafts. Its due time is kept by Still True for release. */
export const HOLD = /* GraphQL */ `
  mutation Hold($id: PostId!, $text: String!, $tagIds: [TagId!]) {
    editPost(input: { id: $id, text: $text, saveToDraft: true, tagIds: $tagIds }) {
      ${POST_ACTION_RESULT}
    }
  }
`;

/** Schedules a held post again, at its original due time or a new one. */
export const RELEASE = /* GraphQL */ `
  mutation Release($id: PostId!, $text: String!, $dueAt: DateTime!, $tagIds: [TagId!]) {
    editPost(
      input: {
        id: $id
        text: $text
        saveToDraft: false
        mode: customScheduled
        dueAt: $dueAt
        tagIds: $tagIds
      }
    ) {
      ${POST_ACTION_RESULT}
    }
  }
`;

/** Replaces the post's text with an approved fix. Scheduling is untouched (no `mode`). */
export const EDIT_TEXT = /* GraphQL */ `
  mutation EditText($id: PostId!, $text: String!) {
    editPost(input: { id: $id, text: $text }) {
      ${POST_ACTION_RESULT}
    }
  }
`;

/** Moves a post to a new due time (used by the weather fix). */
export const RESCHEDULE = /* GraphQL */ `
  mutation Reschedule($id: PostId!, $text: String!, $dueAt: DateTime!) {
    editPost(input: { id: $id, text: $text, mode: customScheduled, dueAt: $dueAt }) {
      ${POST_ACTION_RESULT}
    }
  }
`;

export const SET_TAGS = /* GraphQL */ `
  mutation SetTags($id: PostId!, $text: String!, $tagIds: [TagId!]!) {
    editPost(input: { id: $id, text: $text, tagIds: $tagIds }) {
      ${POST_ACTION_RESULT}
    }
  }
`;

/** Creates a draft that can never publish on its own: used by "Add sample drafts". */
export const CREATE_DRAFT = /* GraphQL */ `
  mutation CreateDraft($input: CreatePostInput!) {
    createPost(input: $input) {
      ${POST_ACTION_RESULT}
    }
  }
`;

export const ADD_NOTE = /* GraphQL */ `
  mutation AddNote($postId: PostId!, $text: String!) {
    createCollaborationNote(input: { subject: { postId: $postId }, text: $text }) {
      __typename
      ... on CreateCollaborationNoteSuccess {
        edge {
          node {
            id
          }
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

export const TAGS = /* GraphQL */ `
  query Tags($organizationId: OrganizationId!) {
    tagsV2(first: 100, input: { organizationId: $organizationId }) {
      edges {
        node {
          id
          name
          color
        }
      }
    }
  }
`;

export const CREATE_TAG = /* GraphQL */ `
  mutation CreateTag($organizationId: OrganizationId!, $name: String!, $color: String!) {
    createTag(input: { organizationId: $organizationId, tag: { name: $name, color: $color } }) {
      __typename
      ... on TagActionSuccess {
        tag {
          id
          name
          color
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

export const ALL_OPERATIONS = {
  ACCOUNT,
  CHANNELS,
  QUEUE,
  POST,
  HOLD,
  RELEASE,
  EDIT_TEXT,
  RESCHEDULE,
  SET_TAGS,
  CREATE_DRAFT,
  ADD_NOTE,
  TAGS,
  CREATE_TAG,
} as const;
