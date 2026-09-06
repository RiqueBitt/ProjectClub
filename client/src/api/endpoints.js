import { api } from './client';

// --- Auth ---
export const registerUser = (payload) => api.post('/auth/register', payload).then((r) => r.data);
export const loginUser = (payload) => api.post('/auth/login', payload).then((r) => r.data);
export const submitApplication = (payload) => api.post('/applications', payload).then((r) => r.data);
export const adminListApplications = (status) => api.get('/applications/admin/all', { params: status ? { status } : {} }).then((r) => r.data);
export const approveApplication = (id) => api.post(`/applications/admin/${id}/approve`).then((r) => r.data);
export const rejectApplication = (id, reason) => api.post(`/applications/admin/${id}/reject`, { reason }).then((r) => r.data);
export const logoutUser = () => api.post('/auth/logout').then((r) => r.data);
export const fetchMe = () => api.get('/auth/me').then((r) => r.data);
export const sendVerificationCode = () => api.post('/auth/verify-email/send').then((r) => r.data);
export const confirmVerificationCode = (code) => api.post('/auth/verify-email/confirm', { code }).then((r) => r.data);
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email }).then((r) => r.data);
export const resetPassword = (token, newPassword) => api.post('/auth/reset-password', { token, newPassword }).then((r) => r.data);
export const setup2FA = () => api.post('/auth/2fa/setup').then((r) => r.data);
export const confirm2FA = (code) => api.post('/auth/2fa/confirm', { code }).then((r) => r.data);
export const disable2FA = (password) => api.post('/auth/2fa/disable', { password }).then((r) => r.data);
export const changePassword = (currentPassword, newPassword) => api.post('/auth/change-password', { currentPassword, newPassword }).then((r) => r.data);
export const deleteAccount = (password) => api.post('/auth/delete-account', { password }).then((r) => r.data);
export const listSessions = () => api.get('/auth/sessions').then((r) => r.data);
export const revokeSession = (id) => api.delete(`/auth/sessions/${id}`).then((r) => r.data);
export const revokeOtherSessions = () => api.delete('/auth/sessions/other').then((r) => r.data);

// --- Users / profile ---
export const updateProfile = (payload) => api.patch('/users/me', payload).then((r) => r.data);
export const setActiveTag = (active) => api.patch('/users/me/tag', { active }).then((r) => r.data);
export const setPreferredTheme = (theme) => api.patch('/users/me/theme', { theme }).then((r) => r.data);
export const setEmojiStyle = (emojiStyle) => api.patch('/users/me/emoji-style', { emojiStyle }).then((r) => r.data);
export const updateUsername = (username) => api.patch('/users/me/username', { username }).then((r) => r.data);
export const uploadAvatar = (file) => {
  const fd = new FormData(); fd.append('avatar', file);
  return api.post('/users/me/avatar', fd).then((r) => r.data);
};
export const uploadBanner = (file) => {
  const fd = new FormData(); fd.append('banner', file);
  return api.post('/users/me/banner', fd).then((r) => r.data);
};
export const uploadMiniProfileBanner = (file) => {
  const fd = new FormData(); fd.append('banner', file);
  return api.post('/users/me/mini-banner', fd).then((r) => r.data);
};
export const uploadIdCard = (file) => {
  const fd = new FormData(); fd.append('idCard', file);
  return api.post('/users/me/id-card', fd).then((r) => r.data);
};
export const removeIdCard = () => api.delete('/users/me/id-card').then((r) => r.data);
export const setStatus = (status) => api.patch('/users/me/status', { status }).then((r) => r.data);
export const setCustomStatus = (payload) => api.patch('/users/me/custom-status', payload).then((r) => r.data);
export const searchUsers = (q) => api.get('/users/search', { params: { q } }).then((r) => r.data);
export const getUserProfile = (id) => api.get(`/users/${id}`).then((r) => r.data);
export const voteProfile = (id, value) => api.post(`/users/${id}/vote`, { value }).then((r) => r.data);
export const listUsableEmojis = () => api.get('/users/me/usable-emojis').then((r) => r.data);
export const listFavoriteGifs = () => api.get('/users/me/favorite-gifs').then((r) => r.data);
export const addFavoriteGif = (gif) => api.post('/users/me/favorite-gifs', gif).then((r) => r.data);
export const removeFavoriteGif = (gifId) => api.delete(`/users/me/favorite-gifs/${encodeURIComponent(gifId)}`).then((r) => r.data);

// --- Friends ---
export const listFriends = () => api.get('/friends').then((r) => r.data);
export const sendFriendRequest = (username) => api.post('/friends/request', { username }).then((r) => r.data);
export const respondFriendRequest = (id, action) => api.post(`/friends/${id}/respond`, { action }).then((r) => r.data);
export const removeFriend = (id) => api.delete(`/friends/${id}`).then((r) => r.data);
export const blockUser = (username) => api.post('/friends/block', { username }).then((r) => r.data);

// --- Conversations / DMs ---
export const listConversations = () => api.get('/conversations').then((r) => r.data);
export const createConversation = (userIds, name) => api.post('/conversations', { userIds, name }).then((r) => r.data);
export const markConversationRead = (id) => api.post(`/conversations/${id}/read`).then((r) => r.data);
export const addConversationMember = (id, userId) => api.post(`/conversations/${id}/members`, { userId }).then((r) => r.data);
export const renameConversation = (id, name) => api.patch(`/conversations/${id}`, { name }).then((r) => r.data);
export const uploadConversationIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/conversations/${id}/icon`, fd).then((r) => r.data);
};
export const leaveConversation = (id) => api.delete(`/conversations/${id}/members/me`).then((r) => r.data);

// --- Messages (shared by DMs and channels) ---
export const listMessages = (params) => api.get('/messages', { params }).then((r) => r.data);
export const searchMessages = (params) => api.get('/messages/search', { params }).then((r) => r.data);
export const sendMessage = (formData) => api.post('/messages', formData).then((r) => r.data);
export const createPoll = (payload) => api.post('/polls', payload).then((r) => r.data);
export const votePoll = (pollId, optionIndex) => api.post(`/polls/${pollId}/vote`, { optionIndex }).then((r) => r.data);
export const editMessage = (id, content) => api.patch(`/messages/${id}`, { content }).then((r) => r.data);
export const deleteMessage = (id, reason) => api.delete(`/messages/${id}`, { data: { reason } }).then((r) => r.data);
export const togglePinMessage = (id) => api.post(`/messages/${id}/pin`).then((r) => r.data);
export const toggleArchiveTopic = (id) => api.post(`/messages/${id}/archive`).then((r) => r.data);
export const reactToMessage = (id, emoji) => api.post(`/messages/${id}/react`, { emoji }).then((r) => r.data);
export const setMessagePostIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/messages/${id}/icon`, fd).then((r) => r.data);
};

// --- Comunidade: perfil da comunidade, categorias, canais, cargos, emojis, moderação ---
export const getCommunity = () => api.get('/community').then((r) => r.data);
export const getCommunitySettings = () => api.get('/admin/community').then((r) => r.data);
export const uploadCommunityIcon = (file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post('/admin/community/icon', fd).then((r) => r.data);
};
export const uploadCommunityBanner = (file) => {
  const fd = new FormData(); fd.append('banner', file);
  return api.post('/admin/community/banner', fd).then((r) => r.data);
};

// --- Economia (adaptado do bot Robbie — moedas + baú diário; loja de
// cores, empregos e cassino foram removidos por pedido do usuário) ---
export const getMyEconomy = () => api.get('/economy').then((r) => r.data);
export const claimDaily = () => api.post('/economy/daily').then((r) => r.data);
export const listChests = () => api.get('/economy/chests').then((r) => r.data);

export const adminListChests = () => api.get('/economy/admin/chests').then((r) => r.data);
export const adminCreateChest = (payload) => api.post('/economy/admin/chests', payload).then((r) => r.data);
export const adminUpdateChest = (id, payload) => api.patch(`/economy/admin/chests/${id}`, payload).then((r) => r.data);
export const adminDeleteChest = (id) => api.delete(`/economy/admin/chests/${id}`).then((r) => r.data);

export const getRank = () => api.get('/economy/rank').then((r) => r.data);
export const listLeaderboard = () => api.get('/economy/leaderboard').then((r) => r.data);

// --- Casas/decoração (adaptado do bot Robbie — fase 3) ---
export const listHouseCatalog = () => api.get('/houses/catalog/houses').then((r) => r.data);
export const buyHouse = (id) => api.post(`/houses/catalog/houses/${id}/buy`).then((r) => r.data);
export const listFurnitureCatalog = () => api.get('/houses/catalog/furniture').then((r) => r.data);
export const buyFurniture = (id) => api.post(`/houses/catalog/furniture/${id}/buy`).then((r) => r.data);
export const listMyHouses = () => api.get('/houses/mine').then((r) => r.data);
export const getHouseLayout = (houseId) => api.get(`/houses/mine/${houseId}`).then((r) => r.data);
export const setActiveHouse = (houseId) => api.post(`/houses/mine/${houseId}/active`).then((r) => r.data);
export const saveHouseLayout = (houseId, items) => api.put(`/houses/mine/${houseId}/layout`, { items }).then((r) => r.data);
export const getHouseGallery = () => api.get('/houses/gallery').then((r) => r.data);
export const listMapBackgrounds = () => api.get('/houses/catalog/maps').then((r) => r.data);
export const buyMapBackground = (id) => api.post(`/houses/catalog/maps/${id}/buy`).then((r) => r.data);
export const adminCreateMapBackground = (formData) => api.post('/houses/admin/catalog/maps', formData).then((r) => r.data);
export const adminUpdateMapBackground = (id, formData) => api.patch(`/houses/admin/catalog/maps/${id}`, formData).then((r) => r.data);
export const adminDeleteMapBackground = (id) => api.delete(`/houses/admin/catalog/maps/${id}`).then((r) => r.data);
export const setHouseMapBackground = (houseId, mapBackgroundId, groupPosition) => api.patch(`/houses/mine/${houseId}/map`, { mapBackgroundId, groupPosition }).then((r) => r.data);

// --- Figurinhas/álbum (adaptado do bot Robbie — fase 4) ---
export const getStickerCollection = (page) => api.get('/stickers', { params: page ? { page } : {} }).then((r) => r.data);
export const buyStickerCapsules = (quantity) => api.post('/stickers/capsules/buy', { quantity }).then((r) => r.data);
export const openAllCapsules = () => api.post('/stickers/capsules/open-all').then((r) => r.data);
export const pasteSticker = (id) => api.post(`/stickers/${id}/paste`).then((r) => r.data);
export const adminGetAlbumLayout = () => api.get('/stickers/admin/album-layout').then((r) => r.data);
export const adminUpdateAlbumSettings = (payload) => api.patch('/stickers/admin/album-layout/settings', payload).then((r) => r.data);
export const adminUpsertAlbumSlot = (slotKey, payload) => api.put(`/stickers/admin/album-layout/slots/${slotKey}`, payload).then((r) => r.data);
export const adminAssignStickerPosition = (id, page, slotKey) => api.patch(`/stickers/admin/${id}/position`, { page, slotKey }).then((r) => r.data);
export const updateCommunitySettings = (payload) => api.patch('/admin/community', payload).then((r) => r.data);

// --- Emojis da comunidade ---
export const listEmojis = () => api.get('/community/emojis').then((r) => r.data);
export const createEmoji = (file, payload) => {
  const fd = new FormData();
  fd.append('emoji', file);
  Object.entries(payload || {}).forEach(([k, v]) => v !== undefined && fd.append(k, v));
  return api.post('/community/emojis', fd).then((r) => r.data);
};
export const updateEmoji = (id, payload) => api.patch(`/community/emojis/${id}`, payload).then((r) => r.data);
export const deleteEmoji = (id) => api.delete(`/community/emojis/${id}`).then((r) => r.data);
// Item pedido: "sistema de figurinhas" — mesmo padrão de
// listEmojis/createEmoji/deleteEmoji acima.
export const listServerStickers = () => api.get('/community/stickers').then((r) => r.data);
export const createServerSticker = (file, name, collectionId) => {
  const fd = new FormData();
  fd.append('sticker', file);
  fd.append('name', name);
  if (collectionId) fd.append('collectionId', collectionId);
  return api.post('/community/stickers', fd).then((r) => r.data);
};
export const deleteServerSticker = (id) => api.delete(`/community/stickers/${id}`).then((r) => r.data);
export const updateServerSticker = (id, payload) => api.patch(`/community/stickers/${id}`, payload).then((r) => r.data);
// Item pedido: "sistema de coleções de emoji personalizado e figurinha"
// — kind é 'EMOJI' ou 'STICKER'.
export const listAssetCollections = (kind) => api.get(`/community/collections/${kind}`).then((r) => r.data);
export const createAssetCollection = (kind, name, iconFile) => {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('icon', iconFile);
  return api.post(`/community/collections/${kind}`, fd).then((r) => r.data);
};
export const updateAssetCollection = (id, { name, iconFile } = {}) => {
  const fd = new FormData();
  if (name !== undefined) fd.append('name', name);
  if (iconFile) fd.append('icon', iconFile);
  return api.patch(`/community/collections/${id}`, fd).then((r) => r.data);
};
export const deleteAssetCollection = (id) => api.delete(`/community/collections/${id}`).then((r) => r.data);

export const adminGetUserSecurityInfo = (userId) => api.get(`/admin/users/${userId}/security-info`).then((r) => r.data);
export const getPlatformStatus = () => api.get('/platform/status').then((r) => r.data);
export const getPlatformStats = () => api.get('/platform/stats').then((r) => r.data);
export const adminSetMaintenanceMode = (enabled, message) => api.post('/admin/maintenance', { enabled, message }).then((r) => r.data);
export const adminCreateAnnouncement = (payload) => api.post('/admin/announcements', payload).then((r) => r.data);
export const adminUploadAnnouncementBanner = (id, file) => {
  const fd = new FormData(); fd.append('banner', file);
  return api.post(`/admin/announcements/${id}/banner`, fd).then((r) => r.data);
};
export const adminListAnnouncements = () => api.get('/admin/announcements').then((r) => r.data);
export const getActiveAnnouncement = () => api.get('/platform/announcements/active').then((r) => r.data);
export const dismissAnnouncement = (id) => api.post(`/platform/announcements/${id}/dismiss`).then((r) => r.data);

// --- Categorias ---
export const createCategory = (name) => api.post('/community/categories', { name }).then((r) => r.data);
export const updateCategory = (id, name) => api.patch(`/community/categories/${id}`, { name }).then((r) => r.data);
export const reorderCategories = (order) => api.post('/community/categories/reorder', { order }).then((r) => r.data);
export const deleteCategory = (id) => api.delete(`/community/categories/${id}`).then((r) => r.data);
export const listCategoryOverwrites = (id) => api.get(`/community/categories/${id}/overwrites`).then((r) => r.data);
export const setCategoryOverwrite = (id, payload) => api.post(`/community/categories/${id}/overwrites`, payload).then((r) => r.data);
export const deleteCategoryOverwrite = (id, overwriteId) => api.delete(`/community/categories/${id}/overwrites/${overwriteId}`).then((r) => r.data);

// --- Canais ---
export const createChannel = (payload) => api.post('/community/channels', payload).then((r) => r.data);
export const updateChannel = (id, payload) => api.patch(`/community/channels/${id}`, payload).then((r) => r.data);
export const reorderChannels = (order) => api.post('/community/channels/reorder', { order }).then((r) => r.data);
export const deleteChannel = (id) => api.delete(`/community/channels/${id}`).then((r) => r.data);
export const markChannelRead = (id) => api.post(`/community/channels/${id}/read`).then((r) => r.data);
export const listChannelOverwrites = (id) => api.get(`/community/channels/${id}/overwrites`).then((r) => r.data);
export const setChannelOverwrite = (id, payload) => api.post(`/community/channels/${id}/overwrites`, payload).then((r) => r.data);
export const deleteChannelOverwrite = (id, overwriteId) => api.delete(`/community/channels/${id}/overwrites/${overwriteId}`).then((r) => r.data);

// --- Cargos ---
export const listRoles = () => api.get('/community/roles').then((r) => r.data);
export const createRole = (payload) => api.post('/community/roles', payload).then((r) => r.data);
export const updateRole = (id, payload) => api.patch(`/community/roles/${id}`, payload).then((r) => r.data);
export const deleteRole = (id) => api.delete(`/community/roles/${id}`).then((r) => r.data);
export const reorderRoles = (order) => api.post('/community/roles/reorder', { order }).then((r) => r.data);
export const uploadRoleIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/community/roles/${id}/icon`, fd).then((r) => r.data);
};
export const assignRole = (userId, roleId) => api.post(`/community/members/${userId}/roles/${roleId}`).then((r) => r.data);
export const unassignRole = (userId, roleId) => api.delete(`/community/members/${userId}/roles/${roleId}`).then((r) => r.data);

// --- Moderação ---
export const listBans = () => api.get('/community/bans').then((r) => r.data);
export const banMember = (userId, payload) => api.post(`/community/bans/${userId}`, payload).then((r) => r.data);
export const unbanMember = (userId) => api.delete(`/community/bans/${userId}`).then((r) => r.data);
export const timeoutMember = (userId, payload) => api.post(`/community/members/${userId}/timeout`, payload).then((r) => r.data);
export const removeTimeout = (userId) => api.delete(`/community/members/${userId}/timeout`).then((r) => r.data);
export const listWarnings = (userId) => api.get(userId ? `/community/members/${userId}/warnings` : '/community/warnings').then((r) => r.data);
export const warnMember = (userId, reason) => api.post(`/community/members/${userId}/warnings`, { reason }).then((r) => r.data);
export const deleteWarning = (warningId) => api.delete(`/community/warnings/${warningId}`).then((r) => r.data);
export const listAuditLog = (cursor) => api.get('/community/audit-log', { params: cursor ? { cursor } : {} }).then((r) => r.data);

// --- AutoMod ---
export const listAutoModRules = () => api.get('/community/automod').then((r) => r.data);
export const createAutoModRule = (payload) => api.post('/community/automod', payload).then((r) => r.data);
export const updateAutoModRule = (id, payload) => api.patch(`/community/automod/${id}`, payload).then((r) => r.data);
export const deleteAutoModRule = (id) => api.delete(`/community/automod/${id}`).then((r) => r.data);

// --- Platform admin ---
export const adminGetStats = () => api.get('/admin/stats').then((r) => r.data);
export const adminListAuditLog = () => api.get('/admin/audit-log').then((r) => r.data);
export const adminListUsers = (q) => api.get('/admin/users', { params: q ? { q } : {} }).then((r) => r.data);
export const adminUpdateUser = (id, payload) => api.patch(`/admin/users/${id}`, payload).then((r) => r.data);
export const adminBanUser = (id, reason) => api.post(`/admin/users/${id}/ban`, { reason }).then((r) => r.data);
export const adminUnbanUser = (id) => api.delete(`/admin/users/${id}/ban`).then((r) => r.data);
export const adminSuspendUser = (id, hours, reason) => api.post(`/admin/users/${id}/suspend`, { hours, reason }).then((r) => r.data);
export const adminUnsuspendUser = (id) => api.delete(`/admin/users/${id}/suspend`).then((r) => r.data);
export const adminSetPlatformRole = (id, role) => api.patch(`/admin/users/${id}/role`, { role }).then((r) => r.data);
export const adminListBadges = () => api.get('/admin/badges').then((r) => r.data);
export const adminCreateBadge = (payload) => api.post('/admin/badges', payload).then((r) => r.data);
export const adminUpdateBadge = (id, payload) => api.patch(`/admin/badges/${id}`, payload).then((r) => r.data);
export const adminDeleteBadge = (id) => api.delete(`/admin/badges/${id}`).then((r) => r.data);
export const adminUploadBadgeIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/admin/badges/${id}/icon`, fd).then((r) => r.data);
};
export const adminGrantBadge = (id, badgeId) => api.post(`/admin/users/${id}/badges`, { badgeId }).then((r) => r.data);
export const adminRevokeBadge = (id, badgeId) => api.delete(`/admin/users/${id}/badges/${badgeId}`).then((r) => r.data);
export const adminSetUserLevel = (id, level) => api.patch(`/admin/users/${id}/level`, { level }).then((r) => r.data);
export const adminAddUserXp = (id, amount) => api.post(`/admin/users/${id}/xp`, { amount }).then((r) => r.data);
export const adminAddUserCurrency = (id, { coins, gems }) => api.post(`/admin/users/${id}/currency`, { coins, gems }).then((r) => r.data);

// --- Administração de casas e móveis ---
export const adminListHouseCatalog = () => api.get('/houses/admin/catalog/houses').then((r) => r.data);
export const adminCreateHouse = (payload) => api.post('/houses/admin/catalog/houses', payload).then((r) => r.data);
export const adminUpdateHouse = (id, payload) => api.patch(`/houses/admin/catalog/houses/${id}`, payload).then((r) => r.data);
export const adminSetStarterHouse = (id) => api.post(`/houses/admin/houses/${id}/starter`).then((r) => r.data);
export const adminClearStarterHouse = () => api.post('/houses/admin/houses/starter/clear').then((r) => r.data);
export const adminSetStarterMap = (id) => api.post(`/houses/admin/maps/${id}/starter`).then((r) => r.data);
export const adminClearStarterMap = () => api.post('/houses/admin/maps/starter/clear').then((r) => r.data);
export const adminListHouseGroups = () => api.get('/houses/admin/groups').then((r) => r.data);
export const adminSetHouseGroup = (id, payload) => api.post(`/houses/admin/groups/${id}`, payload).then((r) => r.data);
export const adminDeleteHouseGroup = (id) => api.delete(`/houses/admin/groups/${id}`).then((r) => r.data);
export const adminDeleteHouse = (id) => api.delete(`/houses/admin/catalog/houses/${id}`).then((r) => r.data);

export const adminListFurnitureCategories = () => api.get('/houses/admin/catalog/furniture-categories').then((r) => r.data);
export const adminCreateFurnitureCategory = (payload) => api.post('/houses/admin/catalog/furniture-categories', payload).then((r) => r.data);

export const adminListFurnitureCatalog = () => api.get('/houses/admin/catalog/furniture').then((r) => r.data);
export const adminCreateFurniture = (formData) => api.post('/houses/admin/catalog/furniture', formData).then((r) => r.data);
export const adminUpdateFurniture = (id, formData) => api.patch(`/houses/admin/catalog/furniture/${id}`, formData).then((r) => r.data);
export const adminDeleteFurniture = (id) => api.delete(`/houses/admin/catalog/furniture/${id}`).then((r) => r.data);

// --- Toggles de sistema ---
export const getSystemToggles = () => api.get('/admin/system-toggles').then((r) => r.data);
export const adminUpdateSystemToggles = (system, enabled) => api.patch('/admin/system-toggles', { system, enabled }).then((r) => r.data);

// --- Moderação de recados de casa ---
export const adminListHouseComments = () => api.get('/houses/admin/comments').then((r) => r.data);
export const adminDeleteHouseCommentMod = (commentId) => api.delete(`/houses/admin/comments/${commentId}`).then((r) => r.data);

// --- Tickets de suporte (adaptado do /ticket do bot Robbie) ---
export const listMyTickets = () => api.get('/tickets/mine').then((r) => r.data);
export const createTicket = (subject, content) => api.post('/tickets', { subject, content }).then((r) => r.data);
export const getTicket = (id) => api.get(`/tickets/${id}`).then((r) => r.data);
export const addTicketMessage = (id, content) => api.post(`/tickets/${id}/messages`, { content }).then((r) => r.data);
export const adminListTickets = (status) => api.get('/tickets/admin/all', { params: status ? { status } : {} }).then((r) => r.data);
export const claimTicket = (id) => api.post(`/tickets/${id}/claim`).then((r) => r.data);
export const closeTicket = (id) => api.post(`/tickets/${id}/close`).then((r) => r.data);

// --- Editor de Interface (staff reorganiza/redimensiona os menus principais) ---
export const getUiLayout = () => api.get('/ui-layout').then((r) => r.data);
export const updateUiLayout = (device, config) => api.put(`/ui-layout/${device}`, config).then((r) => r.data);
export const resetUiLayout = (device) => api.delete(`/ui-layout/${device}`).then((r) => r.data);

// --- Automod de DM (sinalização de palavras + visualização secreta pra staff) ---
export const adminListAutomodFlags = (status) => api.get('/admin/automod-flags', { params: status ? { status } : {} }).then((r) => r.data);
export const adminGetFlaggedConversation = (id) => api.get(`/admin/automod-flags/${id}/conversation`).then((r) => r.data);
export const adminResolveAutomodFlag = (id, status) => api.post(`/admin/automod-flags/${id}/resolve`, { status }).then((r) => r.data);

// --- Sistema de segurança "isca" (honeypot) ---
export const adminListHoneypotHits = () => api.get('/admin/honeypot/hits').then((r) => r.data);
export const adminListBlockedIps = () => api.get('/admin/honeypot/blocked').then((r) => r.data);
export const adminUnblockIp = (ip) => api.delete(`/admin/honeypot/blocked/${encodeURIComponent(ip)}`).then((r) => r.data);
export const adminReloadUserPresence = () => api.post('/admin/reload-user-presence').then((r) => r.data);
export const adminDeleteUserAccount = (id, confirmUsername) => api.delete(`/admin/users/${id}`, { data: { confirmUsername } }).then((r) => r.data);

// --- Fusão com o Reddit clone (fase 2) — Clubes (staff-only), categorias, posts, votos e comentários ---
export const listCommunities = () => api.get('/communities').then((r) => r.data);
export const createCommunity = (payload) => api.post('/communities', payload).then((r) => r.data);
export const getCommunityBySlug = (slug) => api.get(`/communities/${slug}`).then((r) => r.data);
export const updateCommunity = (slug, payload) => api.patch(`/communities/${slug}`, payload).then((r) => r.data);
export const uploadCommunityIconForSlug = (slug, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/communities/${slug}/icon`, fd).then((r) => r.data);
};
export const deleteCommunity = (slug) => api.delete(`/communities/${slug}`).then((r) => r.data);

export const createClubCategory = (slug, payload) => api.post(`/communities/${slug}/categories`, payload).then((r) => r.data);
export const updateClubCategory = (id, payload) => api.patch(`/communities/categories/${id}`, payload).then((r) => r.data);
export const uploadClubCategoryImage = (id, kind, file) => {
  const fd = new FormData(); fd.append('image', file);
  return api.post(`/communities/categories/${id}/${kind === 'banner' ? 'banner' : 'icon'}`, fd).then((r) => r.data);
};
export const deleteClubCategory = (id) => api.delete(`/communities/categories/${id}`).then((r) => r.data);

export const listPosts = (params) => api.get('/posts', { params }).then((r) => r.data);
export const createPost = (payload) => api.post('/posts', payload).then((r) => r.data);
export const uploadPostImage = (file) => {
  const fd = new FormData(); fd.append('image', file);
  return api.post('/posts/upload-image', fd).then((r) => r.data);
};
export const getPost = (id) => api.get(`/posts/${id}`).then((r) => r.data);
export const deletePost = (id) => api.delete(`/posts/${id}`).then((r) => r.data);
export const votePost = (id, value) => api.post(`/posts/${id}/vote`, { value }).then((r) => r.data);

export const listPostComments = (postId) => api.get(`/posts/${postId}/comments`).then((r) => r.data);
export const addPostComment = (postId, content, parentId) => api.post(`/posts/${postId}/comments`, { content, parentId }).then((r) => r.data);
export const votePostComment = (commentId, value) => api.post(`/posts/comments/${commentId}/vote`, { value }).then((r) => r.data);
export const deletePostComment = (commentId) => api.delete(`/posts/comments/${commentId}`).then((r) => r.data);

// --- Conquistas ---
export const listAchievements = () => api.get('/achievements').then((r) => r.data);
export const setDisplayedAchievements = (slot, achievementIds) => api.patch('/users/me/displayed-achievements', { slot, achievementIds }).then((r) => r.data);
export const adminListAchievements = () => api.get('/achievements/admin').then((r) => r.data);
export const adminCreateAchievement = (payload) => api.post('/achievements/admin', payload).then((r) => r.data);
export const adminUpdateAchievement = (id, payload) => api.patch(`/achievements/admin/${id}`, payload).then((r) => r.data);
export const adminUploadAchievementIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/achievements/admin/${id}/icon`, fd).then((r) => r.data);
};
export const adminDeleteAchievement = (id) => api.delete(`/achievements/admin/${id}`).then((r) => r.data);

// --- Atualizações (changelog) ---
export const listUpdates = () => api.get('/updates').then((r) => r.data);
export const createUpdate = (payload) => api.post('/updates', payload).then((r) => r.data);
export const updateUpdateEntry = (id, payload) => api.patch(`/updates/${id}`, payload).then((r) => r.data);
export const deleteUpdateEntry = (id) => api.delete(`/updates/${id}`).then((r) => r.data);

// Item pedido: "sistema de eventos integrado ao painel da Staff"
export const listEvents = () => api.get('/events').then((r) => r.data);
export const createEvent = (payload) => api.post('/events', payload).then((r) => r.data);
export const updateEvent = (id, payload) => api.patch(`/events/${id}`, payload).then((r) => r.data);
export const deleteEvent = (id) => api.delete(`/events/${id}`).then((r) => r.data);
export const uploadEventBanner = (id, file) => {
  const fd = new FormData(); fd.append('banner', file);
  return api.post(`/events/${id}/banner`, fd).then((r) => r.data);
};
export const uploadEventIcon = (id, file) => {
  const fd = new FormData(); fd.append('icon', file);
  return api.post(`/events/${id}/icon`, fd).then((r) => r.data);
};

// Item pedido: "vídeos publicados no canal do YouTube" (categoria Início)
export const listYoutubeVideos = () => api.get('/youtube/videos').then((r) => r.data);

// Item pedido: "posts da comunidade em destaque durante o mês" (categoria Início)
export const listFeaturedPosts = () => api.get('/posts/featured').then((r) => r.data);

// --- Push notifications (Android) ---
export const registerPushToken = (token, platform) => api.post('/push/register', { token, platform }).then((r) => r.data);
export const unregisterPushToken = (token) => api.post('/push/unregister', { token }).then((r) => r.data);

// --- Agora.io (chamadas de voz) ---
export const getAgoraToken = (channelName) => api.get('/agora/token', { params: { channelName } }).then((r) => r.data);

// --- Item pedido: sistemas estilo Orkut ---
export const writeTestimonial = (targetId, text) => api.post(`/testimonials/${targetId}`, { text }).then((r) => r.data);
export const listApprovedTestimonials = (targetId, page = 1) => api.get(`/testimonials/${targetId}`, { params: { page } }).then((r) => r.data);
export const listPendingTestimonials = () => api.get('/testimonials/pending/mine').then((r) => r.data);
export const respondTestimonial = (id, action) => api.post(`/testimonials/${id}/respond`, { action }).then((r) => r.data);
export const deleteTestimonial = (id) => api.delete(`/testimonials/${id}`).then((r) => r.data);

export const writeScrap = (targetId, text) => api.post(`/scraps/${targetId}`, { text }).then((r) => r.data);
export const listScraps = (targetId, page = 1) => api.get(`/scraps/${targetId}`, { params: { page } }).then((r) => r.data);
export const deleteScrap = (id) => api.delete(`/scraps/${id}`).then((r) => r.data);

export const getFanStatus = (targetId) => api.get(`/fans/${targetId}`).then((r) => r.data);
export const toggleFan = (targetId) => api.post(`/fans/${targetId}/toggle`).then((r) => r.data);

export const voteRanking = (targetId, category) => api.post(`/rankings/${targetId}`, { category }).then((r) => r.data);
export const myRankingVotes = () => api.get('/rankings/mine').then((r) => r.data);
export const topRankingsAmongFriends = () => api.get('/rankings/top-among-friends').then((r) => r.data);

export const registerProfileVisit = (targetId) => api.post(`/profile-visits/${targetId}`).then((r) => r.data);
export const listProfileVisitors = (targetId) => api.get(`/profile-visits/${targetId}`).then((r) => r.data);

export const uploadPhoto = (file, caption) => {
  const fd = new FormData();
  fd.append('photo', file);
  if (caption) fd.append('caption', caption);
  return api.post('/photos', fd).then((r) => r.data);
};
export const listPhotosByOwner = (ownerId, page = 1) => api.get(`/photos/owner/${ownerId}`, { params: { page } }).then((r) => r.data);
export const getPhoto = (id) => api.get(`/photos/${id}`).then((r) => r.data);
export const deletePhoto = (id) => api.delete(`/photos/${id}`).then((r) => r.data);
export const commentOnPhoto = (id, text) => api.post(`/photos/${id}/comments`, { text }).then((r) => r.data);
export const deletePhotoComment = (commentId) => api.delete(`/photos/comments/${commentId}`).then((r) => r.data);

export const getTraitStatus = (targetId) => api.get(`/traits/${targetId}`).then((r) => r.data);
export const toggleTrait = (targetId, trait) => api.post(`/traits/${targetId}/toggle`, { trait }).then((r) => r.data);

export const sendRelationshipRequest = (partnerId) => api.post('/relationships/request', { partnerId }).then((r) => r.data);
export const respondRelationship = (id, action) => api.post(`/relationships/${id}/respond`, { action }).then((r) => r.data);
export const endRelationship = () => api.post('/relationships/end').then((r) => r.data);
export const listPendingRelationships = () => api.get('/relationships/pending/mine').then((r) => r.data);

export const upcomingBirthdaysAmongFriends = () => api.get('/birthdays/upcoming').then((r) => r.data);

export const createProfilePoll = (question, options) => api.post('/profile-polls', { question, options }).then((r) => r.data);
export const listProfilePollsByAuthor = (authorId) => api.get(`/profile-polls/author/${authorId}`).then((r) => r.data);
export const voteProfilePoll = (id, optionId) => api.post(`/profile-polls/${id}/vote`, { optionId }).then((r) => r.data);
export const deleteProfilePoll = (id) => api.delete(`/profile-polls/${id}`).then((r) => r.data);
