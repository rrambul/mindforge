import type {
  CreateNoteInput,
  ListNotesQuery,
  NoteLanguage,
  NoteLocator,
  NoteSubject,
  UpdateNoteInput,
} from "@mindforge/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "../../../shared/api/http.js";
import { NetworkError, type RequestError } from "../../../shared/api/problem.js";
import { useOfflineQueue } from "../../../shared/lib/queue-context.js";

/** Mirrors the API's NoteView. */
export interface Note {
  readonly id: string;
  readonly body: string;
  readonly subjectType: NoteSubject;
  readonly subjectId: string | null;
  readonly quote: string | null;
  readonly locator: NoteLocator | null;
  readonly isHighlight: boolean;
  readonly pinned: boolean;
  readonly lang: NoteLanguage;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const noteKeys = {
  all: ["notes"] as const,
  list: (query: ListNotesQuery) =>
    ["notes", "list", query.q ?? "", query.subjectType ?? "", query.subjectId ?? ""] as const,
};

function toSearch(query: ListNotesQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.subjectType) params.set("subjectType", query.subjectType);
  if (query.subjectId) params.set("subjectId", query.subjectId);
  if (query.pinned !== undefined) params.set("pinned", String(query.pinned));
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function useNotes(query: ListNotesQuery): UseQueryResult<{ notes: Note[] }> {
  return useQuery({
    queryKey: noteKeys.list(query),
    queryFn: ({ signal }) => api.get<{ notes: Note[] }>(`/notes${toSearch(query)}`, signal),
    // Search results are cheap to refetch and stale ones are actively misleading — a result set
    // that no longer matches what is in the box reads as the search being broken.
    staleTime: 0,
  });
}

/**
 * Builds the body a capture sends, so the mutation's *variables* are the exact request.
 *
 * Same reasoning as `frictionBody`: `onError` has to queue precisely what failed, and deriving it
 * again on retry would mint a new id and throw away idempotency.
 */
export function noteBody(input: {
  body: string;
  subjectType?: NoteSubject;
  subjectId?: string | null;
}): CreateNoteInput {
  return {
    id: crypto.randomUUID(),
    body: input.body,
    subjectType: input.subjectType ?? "standalone",
    ...(input.subjectId == null ? {} : { subjectId: input.subjectId }),
    // The server derives the stemming language from the profile's content language (FR-L4). The
    // client deliberately does not guess: it would be guessing from the *interface* language, which
    // is a different axis.
    lang: "english",
    pinned: false,
  };
}

/**
 * A capture path (FR-N3), so it behaves like friction: optimistic, fire-and-forget, queued when the
 * request never arrives.
 *
 * Not rolled back on a network failure — the note will land, and making the text vanish is how you
 * lose a thought you have already stopped holding in your head.
 */
export function useWriteNote(): UseMutationResult<Note, RequestError, CreateNoteInput> {
  const queryClient = useQueryClient();
  const offline = useOfflineQueue();

  return useMutation({
    mutationFn: (body) => api.post<Note>("/notes", body),
    onError: (error, body) => {
      if (error instanceof NetworkError && offline && body.id) {
        void offline.queue.enqueue(`note:${body.id}`, "/notes", body);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: noteKeys.all }),
  });
}

/**
 * Pinning and editing are not captures — they are considered actions on something already saved, so
 * a failure must be visible rather than queued.
 */
export function useEditNote(): UseMutationResult<
  Note,
  RequestError,
  { id: string; patch: UpdateNoteInput }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }) => api.patch<Note>(`/notes/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: noteKeys.all }),
  });
}

export function useDeleteNote(): UseMutationResult<void, RequestError, { id: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => api.delete<void>(`/notes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: noteKeys.all }),
  });
}
