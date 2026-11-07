import { api } from './client';

// Endpoints da parte "social" (Atividade, enquete em post, RSVP de evento).
// Arquivo separado do endpoints.js pra não brigar com outras edições.
export const getActivityFeed = (params) => api.get('/activity/feed', { params }).then((r) => r.data);
export const toggleActivityCheer = (itemKey) => api.post('/activity/cheer', { itemKey }).then((r) => r.data);
export const celebrateActivity = (payload) => api.post('/activity/celebrate', payload).then((r) => r.data);
export const votePostPoll = (postId, optionId) => api.post(`/posts/${postId}/poll/vote`, { optionId }).then((r) => r.data);
export const setEventRsvp = (eventId, status) => api.post(`/events/${eventId}/rsvp`, { status }).then((r) => r.data);
