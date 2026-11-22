-- Esquema do banco gerado do server/prisma/schema.prisma (MySQL), só pros testes do Rust.
-- Gerar de novo: cd server && npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `publicId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `avatarUrl` VARCHAR(191) NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `miniProfileBannerUrl` VARCHAR(191) NULL,
    `bannerFraming` VARCHAR(32) NULL,
    `miniProfileBannerFraming` VARCHAR(32) NULL,
    `idCardUrl` VARCHAR(191) NULL,
    `idCardFraming` VARCHAR(32) NULL,
    `selectedPendantId` VARCHAR(191) NULL,
    `customPendantUrl` VARCHAR(191) NULL,
    `bio` TEXT NULL,
    `pronouns` VARCHAR(191) NULL,
    `birthDate` DATETIME(3) NULL,
    `levelBarColor` VARCHAR(191) NULL,
    `profileSectionOpacity` INTEGER NULL,
    `miniProfileColor` VARCHAR(191) NULL,
    `miniProfileButtonColor` VARCHAR(191) NULL,
    `statusBubbleColor` VARCHAR(191) NULL,
    `profileColor` VARCHAR(191) NOT NULL DEFAULT '#1877F2',
    `profileNameFont` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `profileNameEffect` VARCHAR(191) NOT NULL DEFAULT 'SOLID',
    `profileNameColor` VARCHAR(191) NOT NULL DEFAULT '#1877F2',
    `profileNameColor2` VARCHAR(191) NOT NULL DEFAULT '#FFFFFF',
    `profileNameColors` TEXT NULL,
    `relationshipPartnerId` VARCHAR(191) NULL,
    `profileSectionOrder` TEXT NULL,
    `preferredTheme` VARCHAR(191) NULL,
    `layoutStyle` VARCHAR(191) NOT NULL DEFAULT 'normal2',
    `layoutVersion` INTEGER NOT NULL DEFAULT 0,
    `chatZoom` DOUBLE NOT NULL DEFAULT 1.0,
    `interfaceZoom` DOUBLE NOT NULL DEFAULT 1.0,
    `emojiStyle` VARCHAR(191) NOT NULL DEFAULT 'native',
    `displayedAchievements` VARCHAR(191) NOT NULL DEFAULT '[]',
    `displayedAchievementsMini` VARCHAR(191) NOT NULL DEFAULT '[]',
    `friendRequestPrivacy` VARCHAR(191) NOT NULL DEFAULT 'EVERYONE',
    `accountLevel` INTEGER NOT NULL DEFAULT 1,
    `accountXp` INTEGER NOT NULL DEFAULT 0,
    `lastXpMessageAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OFFLINE',
    `autoIdle` BOOLEAN NOT NULL DEFAULT false,
    `customStatus` VARCHAR(191) NULL,
    `customStatusEmoji` VARCHAR(191) NULL,
    `customStatusExpiresAt` DATETIME(3) NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorSecret` VARCHAR(191) NULL,
    `twoFactorLastUsedStep` INTEGER NULL,
    `platformRole` VARCHAR(191) NOT NULL DEFAULT 'USER',
    `supporterTier` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `supporterUntil` DATETIME(3) NULL,
    `platformAdminBootstrappedAt` DATETIME(3) NULL,
    `usernameChangedAt` DATETIME(3) NULL,
    `isPlatformBanned` BOOLEAN NOT NULL DEFAULT false,
    `platformBanReason` VARCHAR(191) NULL,
    `suspendedUntil` DATETIME(3) NULL,
    `timeoutUntil` DATETIME(3) NULL,
    `accountDisabledAt` DATETIME(3) NULL,
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `loginLockedUntil` DATETIME(3) NULL,
    `tagEmoji` VARCHAR(191) NULL,
    `tagText` VARCHAR(191) NULL,
    `clanId` VARCHAR(191) NULL,
    `clanRole` VARCHAR(191) NULL,
    `clanTagId` VARCHAR(191) NULL,
    `hasCreatedClan` BOOLEAN NOT NULL DEFAULT false,
    `youtubeUrl` VARCHAR(191) NULL,
    `steamUrl` VARCHAR(191) NULL,
    `robloxUrl` VARCHAR(191) NULL,
    `xUrl` VARCHAR(191) NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `gems` INTEGER NOT NULL DEFAULT 0,
    `avatarDecoration` TEXT NULL,
    `profileEffect` TEXT NULL,
    `profileFont` TEXT NULL,
    `profileStyle` VARCHAR(32) NULL,
    `dailyStreak` INTEGER NOT NULL DEFAULT 0,
    `lastDailyAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `featuredModpackId` VARCHAR(191) NULL,
    `featuredModJson` TEXT NULL,
    `profileShowcase` TEXT NULL,
    `profileWidgets` TEXT NULL,
    `profileWishlist` TEXT NULL,
    `selfDeactivatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_publicId_key`(`publicId`),
    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_username_key`(`username`),
    INDEX `User_customStatusExpiresAt_idx`(`customStatusExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Pendant` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Badge` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `rarity` VARCHAR(191) NOT NULL DEFAULT 'COMMON',
    `ageYears` INTEGER NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Badge_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileVote` (
    `id` VARCHAR(191) NOT NULL,
    `fromUserId` VARCHAR(191) NOT NULL,
    `toUserId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProfileVote_fromUserId_toUserId_key`(`fromUserId`, `toUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserBadge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `badgeId` VARCHAR(191) NOT NULL,
    `awardedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserBadge_userId_badgeId_key`(`userId`, `badgeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FavoriteGif` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `gifId` VARCHAR(512) NOT NULL,
    `url` TEXT NOT NULL,
    `preview` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FavoriteGif_userId_gifId_key`(`userId`, `gifId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `communityName` VARCHAR(191) NOT NULL DEFAULT 'Project Club',
    `communityIconUrl` VARCHAR(191) NULL,
    `communityBannerUrl` VARCHAR(191) NULL,
    `maintenanceMode` BOOLEAN NOT NULL DEFAULT false,
    `maintenanceMessage` VARCHAR(191) NULL,
    `communityTagEmoji` VARCHAR(191) NULL,
    `communityTagText` VARCHAR(191) NULL,
    `disabledSystems` VARCHAR(191) NOT NULL DEFAULT '[]',
    `starterHouseId` VARCHAR(191) NULL,
    `starterMapId` VARCHAR(191) NULL,
    `hiddenFeaturedChannels` VARCHAR(191) NULL,
    `pinguInstructions` TEXT NULL,
    `afkChannelId` VARCHAR(191) NULL,
    `afkTimeoutSeconds` INTEGER NOT NULL DEFAULT 300,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'UPCOMING',
    `voiceChannelId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slug` VARCHAR(100) NULL,

    INDEX `Event_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformAnnouncement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `buttonLabel` VARCHAR(191) NULL,
    `buttonUrl` VARCHAR(191) NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetUserId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnnouncementDismissal` (
    `id` VARCHAR(191) NOT NULL,
    `announcementId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dismissedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AnnouncementDismissal_announcementId_userId_key`(`announcementId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UpdateLogEntry` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `version` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HoneypotHit` (
    `id` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HoneypotHit_ip_idx`(`ip`),
    INDEX `HoneypotHit_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BlockedIp` (
    `id` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `hitCount` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `BlockedIp_ip_key`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthAccount` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OAuthAccount_userId_idx`(`userId`),
    UNIQUE INDEX `OAuthAccount_provider_providerUserId_key`(`provider`, `providerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(191) NULL,
    `replacedById` VARCHAR(191) NULL,
    `sessionStartedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_revoked_idx`(`userId`, `revoked`),
    INDEX `RefreshToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TwoFactorRecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TwoFactorRecoveryCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL DEFAULT 'android',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushToken_token_key`(`token`),
    INDEX `PushToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebPushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WebPushSubscription_endpoint_key`(`endpoint`),
    INDEX `WebPushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduledMessage` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `conversationId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `replyToId` VARCHAR(191) NULL,
    `sendAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `sentMessageId` VARCHAR(191) NULL,
    `error` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimedAt` DATETIME(3) NULL,

    INDEX `ScheduledMessage_status_sendAt_idx`(`status`, `sendAt`),
    INDEX `ScheduledMessage_authorId_status_idx`(`authorId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reminder` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(500) NOT NULL,
    `link` VARCHAR(300) NULL,
    `messageId` VARCHAR(191) NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `firedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Reminder_firedAt_dueAt_idx`(`firedAt`, `dueAt`),
    INDEX `Reminder_userId_firedAt_idx`(`userId`, `firedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MinigameWeeklyPrize` (
    `id` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(10) NOT NULL,
    `game` VARCHAR(40) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rank` INTEGER NOT NULL,
    `score` INTEGER NOT NULL,
    `coins` INTEGER NOT NULL,
    `claimedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MinigameWeeklyPrize_userId_claimedAt_idx`(`userId`, `claimedAt`),
    INDEX `MinigameWeeklyPrize_weekKey_game_idx`(`weekKey`, `game`),
    UNIQUE INDEX `MinigameWeeklyPrize_weekKey_game_userId_key`(`weekKey`, `game`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebPushKeys` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `publicKey` VARCHAR(255) NOT NULL,
    `privateKey` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailVerificationCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailVerificationCode_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PasswordResetToken_token_key`(`token`),
    INDEX `PasswordResetToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Friendship` (
    `id` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `addresseeId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(200) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Friendship_addresseeId_status_idx`(`addresseeId`, `status`),
    INDEX `Friendship_requesterId_status_idx`(`requesterId`, `status`),
    UNIQUE INDEX `Friendship_requesterId_addresseeId_key`(`requesterId`, `addresseeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Testimonial` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Testimonial_targetId_status_idx`(`targetId`, `status`),
    UNIQUE INDEX `Testimonial_authorId_targetId_key`(`authorId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scrap` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Scrap_targetId_createdAt_idx`(`targetId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Fan` (
    `id` VARCHAR(191) NOT NULL,
    `fanId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Fan_fanId_targetId_key`(`fanId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RankingVote` (
    `id` VARCHAR(191) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RankingVote_targetId_category_idx`(`targetId`, `category`),
    UNIQUE INDEX `RankingVote_voterId_category_key`(`voterId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileVisit` (
    `id` VARCHAR(191) NOT NULL,
    `visitorId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `visitCount` INTEGER NOT NULL DEFAULT 1,
    `lastVisitAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProfileVisit_targetId_lastVisitAt_idx`(`targetId`, `lastVisitAt`),
    UNIQUE INDEX `ProfileVisit_visitorId_targetId_key`(`visitorId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Photo` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Photo_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotoComment` (
    `id` VARCHAR(191) NOT NULL,
    `photoId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PhotoComment_photoId_createdAt_idx`(`photoId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TraitVote` (
    `id` VARCHAR(191) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `trait` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TraitVote_targetId_trait_idx`(`targetId`, `trait`),
    UNIQUE INDEX `TraitVote_voterId_targetId_trait_key`(`voterId`, `targetId`, `trait`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RelationshipRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RelationshipRequest_requesterId_partnerId_key`(`requesterId`, `partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfilePoll` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postId` VARCHAR(191) NULL,

    INDEX `ProfilePoll_postId_idx`(`postId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfilePollOption` (
    `id` VARCHAR(191) NOT NULL,
    `pollId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfilePollVote` (
    `id` VARCHAR(191) NOT NULL,
    `pollId` VARCHAR(191) NOT NULL,
    `optionId` VARCHAR(191) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProfilePollVote_pollId_voterId_key`(`pollId`, `voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `isGroup` BOOLEAN NOT NULL DEFAULT false,
    `name` VARCHAR(191) NULL,
    `icon` VARCHAR(191) NULL,
    `ownerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slug` VARCHAR(100) NULL,
    `ephemeralSeconds` INTEGER NULL,

    INDEX `Conversation_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationMember` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastReadAt` DATETIME(3) NULL,
    `inbox` VARCHAR(12) NOT NULL DEFAULT 'main',
    `inboxAcceptedAt` DATETIME(3) NULL,
    `pinnedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ConversationMember_conversationId_userId_key`(`conversationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#99AAB5',
    `icon` VARCHAR(191) NULL,
    `permissions` VARCHAR(191) NOT NULL DEFAULT '0',
    `position` INTEGER NOT NULL DEFAULT 0,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `hoist` BOOLEAN NOT NULL DEFAULT false,
    `mentionable` BOOLEAN NOT NULL DEFAULT true,
    `selfAssignable` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRole` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `UserRole_userId_roleId_key`(`userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `iconEmoji` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Channel` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(512) NULL,
    `slowModeSeconds` INTEGER NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `position` INTEGER NOT NULL DEFAULT 0,
    `isPrivate` BOOLEAN NOT NULL DEFAULT false,
    `userLimit` INTEGER NULL,
    `rulesContent` TEXT NULL,
    `rulesTitle` VARCHAR(191) NULL,
    `iconEmoji` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `slug` VARCHAR(100) NULL,
    `tempOwnerId` VARCHAR(191) NULL,

    INDEX `Channel_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PermissionOverwrite` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `allow` VARCHAR(191) NOT NULL DEFAULT '0',
    `deny` VARCHAR(191) NOT NULL DEFAULT '0',

    UNIQUE INDEX `PermissionOverwrite_channelId_categoryId_targetType_targetId_key`(`channelId`, `categoryId`, `targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationOverride` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetKey` VARCHAR(64) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `level` VARCHAR(16) NULL,
    `mutedUntil` DATETIME(3) NULL,
    `muteForever` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationOverride_targetKey_level_idx`(`targetKey`, `level`),
    INDEX `NotificationOverride_channelId_idx`(`channelId`),
    INDEX `NotificationOverride_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `NotificationOverride_userId_targetKey_key`(`userId`, `targetKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChannelReadState` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `lastReadAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChannelReadState_channelId_userId_key`(`channelId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetCollection` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssetCollection_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Emoji` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'Geral',
    `allowedRoleId` VARCHAR(191) NULL,
    `collectionId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Emoji_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sticker` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Sticker_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SoundboardSound` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `durationMs` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SoundboardSound_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `content` TEXT NULL,
    `title` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `replyToId` VARCHAR(191) NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `pinnedAt` DATETIME(3) NULL,
    `pinnedById` VARCHAR(191) NULL,
    `edited` BOOLEAN NOT NULL DEFAULT false,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `embed` TEXT NULL,
    `icon` VARCHAR(191) NULL,
    `quickReactions` VARCHAR(191) NOT NULL DEFAULT '[]',
    `stickerUrl` VARCHAR(512) NULL,
    `forwardedFrom` TEXT NULL,
    `threadId` VARCHAR(191) NULL,
    `isThread` BOOLEAN NOT NULL DEFAULT false,
    `threadReplyCount` INTEGER NOT NULL DEFAULT 0,
    `threadLastReplyAt` DATETIME(3) NULL,
    `threadLastReplyId` VARCHAR(191) NULL,
    `threadArchivedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,

    INDEX `Message_channelId_createdAt_idx`(`channelId`, `createdAt`),
    INDEX `Message_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `Message_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Message_channelId_authorId_createdAt_idx`(`channelId`, `authorId`, `createdAt`),
    INDEX `Message_threadId_createdAt_idx`(`threadId`, `createdAt`),
    INDEX `Message_isThread_threadLastReplyAt_idx`(`isThread`, `threadLastReplyAt`),
    INDEX `Message_expiresAt_idx`(`expiresAt`),
    FULLTEXT INDEX `Message_content_idx`(`content`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageEdit` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `content` TEXT NULL,
    `editedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MessageEdit_messageId_editedAt_idx`(`messageId`, `editedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemToggle` (
    `key` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutomodFlag` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `matchedWord` VARCHAR(191) NOT NULL,
    `snippet` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Report` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'MESSAGE',
    `messageId` VARCHAR(191) NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reportedUserId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `category` VARCHAR(24) NULL,
    `reason` TEXT NOT NULL,
    `snippet` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Report_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Poll` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `options` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Poll_messageId_key`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollVote` (
    `id` VARCHAR(191) NOT NULL,
    `pollId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `optionIndex` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PollVote_pollId_userId_key`(`pollId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageMention` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,

    INDEX `MessageMention_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `MessageMention_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `isSpoiler` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reaction` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Reaction_messageId_userId_emoji_key`(`messageId`, `userId`, `emoji`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ban` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `moderatorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Ban_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warning` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `moderatorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Warning_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLogEntry` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLogEntry_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutoModRule` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `action` VARCHAR(191) NOT NULL DEFAULT 'DELETE',
    `config` VARCHAR(191) NOT NULL DEFAULT '{}',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyChest` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `chanceRegular` DOUBLE NOT NULL,
    `chanceSubscriber` DOUBLE NOT NULL DEFAULT 0,
    `coinsMin` INTEGER NOT NULL,
    `coinsMax` INTEGER NOT NULL,
    `ticketsMin` INTEGER NOT NULL DEFAULT 0,
    `ticketsMax` INTEGER NOT NULL DEFAULT 0,
    `position` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `imageClosed` VARCHAR(191) NULL,
    `imageOpened` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FurnitureCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Furniture` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL DEFAULT 0,
    `imageUrl` VARCHAR(191) NOT NULL,
    `width` INTEGER NOT NULL DEFAULT 200,
    `height` INTEGER NOT NULL DEFAULT 200,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserFurniture` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `furnitureId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `purchasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserFurniture_userId_furnitureId_key`(`userId`, `furnitureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HouseCatalog` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL DEFAULT 0,
    `backgroundColor` VARCHAR(191) NOT NULL DEFAULT '#BFEFFF',
    `imageUrl` VARCHAR(191) NULL,
    `width` INTEGER NOT NULL DEFAULT 1000,
    `height` INTEGER NOT NULL DEFAULT 632,
    `stock` INTEGER NULL,
    `groupId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HouseGroup` (
    `id` INTEGER NOT NULL,
    `x` INTEGER NOT NULL,
    `y` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserHouse` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `houseId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `purchasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mapBackgroundId` VARCHAR(191) NULL,

    UNIQUE INDEX `UserHouse_userId_houseId_key`(`userId`, `houseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MapBackground` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL DEFAULT 50,
    `stock` INTEGER NULL,
    `width` INTEGER NOT NULL DEFAULT 1000,
    `height` INTEGER NOT NULL DEFAULT 632,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserMapBackground` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mapBackgroundId` VARCHAR(191) NOT NULL,
    `purchasedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserMapBackground_userId_mapBackgroundId_key`(`userId`, `mapBackgroundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HouseLike` (
    `id` VARCHAR(191) NOT NULL,
    `userHouseId` VARCHAR(191) NOT NULL,
    `likerId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HouseLike_userHouseId_likerId_key`(`userHouseId`, `likerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HouseComment` (
    `id` VARCHAR(191) NOT NULL,
    `userHouseId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlacedFurniture` (
    `id` VARCHAR(191) NOT NULL,
    `userHouseId` VARCHAR(191) NOT NULL,
    `furnitureId` VARCHAR(191) NOT NULL,
    `x` INTEGER NOT NULL DEFAULT 0,
    `y` INTEGER NOT NULL DEFAULT 0,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `zIndex` INTEGER NOT NULL DEFAULT 0,
    `flipped` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerRarity` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 1,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectibleSticker` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `rarityId` VARCHAR(191) NOT NULL,
    `assignedPage` INTEGER NOT NULL DEFAULT 1,
    `assignedSlotKey` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSticker` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `UserSticker_userId_stickerId_key`(`userId`, `stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserStickerAlbum` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `pastedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserStickerAlbum_userId_stickerId_key`(`userId`, `stickerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StickerCapsule` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stickerId` VARCHAR(191) NOT NULL,
    `opened` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `openedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `backgroundColor` VARCHAR(191) NOT NULL DEFAULT '#14161c',
    `backgroundImageUrl` VARCHAR(191) NULL,
    `totalPages` INTEGER NOT NULL DEFAULT 5,
    `showBorder` BOOLEAN NOT NULL DEFAULT false,
    `showNames` BOOLEAN NOT NULL DEFAULT false,
    `width` INTEGER NOT NULL DEFAULT 1780,
    `height` INTEGER NOT NULL DEFAULT 1208,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumSlot` (
    `id` VARCHAR(191) NOT NULL,
    `slotKey` VARCHAR(191) NOT NULL,
    `x` INTEGER NOT NULL,
    `y` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `AlbumSlot_slotKey_key`(`slotKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Achievement` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `rarity` VARCHAR(191) NOT NULL DEFAULT 'COMMON',
    `progressType` VARCHAR(191) NOT NULL,
    `target` INTEGER NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Achievement_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserAchievement` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `achievementId` VARCHAR(191) NOT NULL,
    `unlockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserAchievement_userId_achievementId_key`(`userId`, `achievementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `claimedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,

    INDEX `Ticket_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Ticket_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketMessage` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketMessage_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipApplication` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `birthDate` DATETIME(3) NULL,
    `answers` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `oauthProvider` VARCHAR(191) NULL,
    `oauthProviderUserId` VARCHAR(191) NULL,
    `oauthEmail` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UiLayoutConfig` (
    `device` VARCHAR(191) NOT NULL,
    `railOrder` TEXT NOT NULL,
    `railHidden` TEXT NOT NULL,
    `sidebarWidth` INTEGER NOT NULL DEFAULT 280,
    `membersWidth` INTEGER NOT NULL DEFAULT 240,
    `membersDefaultOpen` BOOLEAN NOT NULL DEFAULT true,
    `panelPositions` TEXT NOT NULL,
    `gifMenuLayout` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`device`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Community` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `postTags` TEXT NULL,

    UNIQUE INDEX `Community_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostCategory` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Post` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `content` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `linkUrl` VARCHAR(191) NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `commentCount` INTEGER NOT NULL DEFAULT 0,
    `tags` TEXT NULL,
    `pinnedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `slug` VARCHAR(100) NULL,

    INDEX `Post_communityId_createdAt_idx`(`communityId`, `createdAt`),
    INDEX `Post_communityId_score_idx`(`communityId`, `score`),
    INDEX `Post_categoryId_createdAt_idx`(`categoryId`, `createdAt`),
    INDEX `Post_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Post_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostVote` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,

    UNIQUE INDEX `PostVote_postId_userId_key`(`postId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostComment` (
    `id` VARCHAR(191) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PostComment_postId_createdAt_idx`(`postId`, `createdAt`),
    INDEX `PostComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostCommentVote` (
    `id` VARCHAR(191) NOT NULL,
    `commentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,

    UNIQUE INDEX `PostCommentVote_commentId_userId_key`(`commentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FileAsset` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FileAsset_storageKey_key`(`storageKey`),
    INDEX `FileAsset_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Clan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `privacyType` VARCHAR(191) NOT NULL DEFAULT 'PUBLIC',
    `iconId` VARCHAR(191) NULL,
    `iconColor` VARCHAR(191) NOT NULL DEFAULT '#80848E',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanIcon` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isDefault` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanTag` (
    `id` VARCHAR(191) NOT NULL,
    `clanId` VARCHAR(191) NOT NULL,
    `tag` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClanTag_tag_key`(`tag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanJoinRequest` (
    `id` VARCHAR(191) NOT NULL,
    `clanId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClanJoinRequest_clanId_userId_key`(`clanId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanInvite` (
    `id` VARCHAR(191) NOT NULL,
    `clanId` VARCHAR(191) NOT NULL,
    `invitedUserId` VARCHAR(191) NOT NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClanInvite_clanId_invitedUserId_key`(`clanId`, `invitedUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanMessage` (
    `id` VARCHAR(191) NOT NULL,
    `clanId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClanMessage_clanId_createdAt_idx`(`clanId`, `createdAt`),
    INDEX `ClanMessage_authorId_createdAt_idx`(`authorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSettings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `language` VARCHAR(191) NOT NULL DEFAULT 'pt-BR',
    `timezone` VARCHAR(191) NULL,
    `timeFormat` VARCHAR(191) NOT NULL DEFAULT '24h',
    `messageDensity` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `messageDisplay` VARCHAR(191) NOT NULL DEFAULT 'cozy',
    `showTimestamps` BOOLEAN NOT NULL DEFAULT true,
    `showAvatars` BOOLEAN NOT NULL DEFAULT true,
    `groupMessages` BOOLEAN NOT NULL DEFAULT true,
    `showLinkPreviews` BOOLEAN NOT NULL DEFAULT true,
    `autoPlayMedia` BOOLEAN NOT NULL DEFAULT true,
    `enterSends` BOOLEAN NOT NULL DEFAULT true,
    `profilePrivacy` VARCHAR(191) NOT NULL DEFAULT 'everyone',
    `dmPrivacy` VARCHAR(191) NOT NULL DEFAULT 'everyone',
    `friendRequestPrivacy` VARCHAR(191) NOT NULL DEFAULT 'everyone',
    `contentFilterLevel` VARCHAR(191) NOT NULL DEFAULT 'moderate',
    `spamFilterEnabled` BOOLEAN NOT NULL DEFAULT true,
    `showReadReceipts` BOOLEAN NOT NULL DEFAULT true,
    `desktopNotifications` BOOLEAN NOT NULL DEFAULT true,
    `emailNotifications` BOOLEAN NOT NULL DEFAULT true,
    `notificationSounds` BOOLEAN NOT NULL DEFAULT true,
    `reducedMotion` BOOLEAN NOT NULL DEFAULT false,
    `highContrast` BOOLEAN NOT NULL DEFAULT false,
    `textScale` DOUBLE NOT NULL DEFAULT 1.0,
    `saturation` INTEGER NOT NULL DEFAULT 100,
    `inputDeviceId` VARCHAR(191) NULL,
    `outputDeviceId` VARCHAR(191) NULL,
    `inputMode` VARCHAR(191) NOT NULL DEFAULT 'voice_activity',
    `pushToTalkKey` VARCHAR(191) NULL,
    `inputVolume` INTEGER NOT NULL DEFAULT 100,
    `outputVolume` INTEGER NOT NULL DEFAULT 100,
    `noiseSuppression` BOOLEAN NOT NULL DEFAULT true,
    `echoCancellation` BOOLEAN NOT NULL DEFAULT true,
    `automaticGain` BOOLEAN NOT NULL DEFAULT true,
    `streamQuality` VARCHAR(191) NOT NULL DEFAULT '1080p',
    `streamFPS` INTEGER NOT NULL DEFAULT 30,
    `streamAudioEnabled` BOOLEAN NOT NULL DEFAULT true,
    `activitySharing` BOOLEAN NOT NULL DEFAULT true,
    `activityVisibility` VARCHAR(191) NOT NULL DEFAULT 'everyone',
    `gameJoinPrivacy` VARCHAR(191) NOT NULL DEFAULT 'friends',
    `gameDetectionEnabled` BOOLEAN NOT NULL DEFAULT true,
    `gamesVisibility` VARCHAR(191) NOT NULL DEFAULT 'friends',
    `overlayEnabled` BOOLEAN NOT NULL DEFAULT false,
    `overlayNotifications` BOOLEAN NOT NULL DEFAULT true,
    `startWithSystem` BOOLEAN NOT NULL DEFAULT false,
    `minimizeToTray` BOOLEAN NOT NULL DEFAULT true,
    `openLinksInApp` BOOLEAN NOT NULL DEFAULT true,
    `confirmOnExit` BOOLEAN NOT NULL DEFAULT false,
    `developerMode` BOOLEAN NOT NULL DEFAULT false,
    `layoutPrefs` TEXT NULL,
    `extraPrefs` TEXT NULL,
    `voiceVolumes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserSettings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserShortcut` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `keyCombination` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserShortcut_userId_keyCombination_key`(`userId`, `keyCombination`),
    UNIQUE INDEX `UserShortcut_userId_action_key`(`userId`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConnectedAccount` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerUserId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `accessToken` VARCHAR(191) NOT NULL,
    `refreshToken` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `showOnProfile` BOOLEAN NOT NULL DEFAULT true,
    `shareActivity` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ConnectedAccount_userId_provider_key`(`userId`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppCatalogItem` (
    `id` VARCHAR(191) NOT NULL,
    `moduleId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `bannerUrl` VARCHAR(191) NULL,
    `iconUrl` VARCHAR(191) NULL,
    `sizeLabel` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,
    `sizeLabelWin` VARCHAR(191) NULL,
    `sizeLabelLinux` VARCHAR(191) NULL,
    `requirementsWin` TEXT NULL,
    `requirementsLinux` TEXT NULL,
    `featuresText` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppCatalogItem_moduleId_key`(`moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppScreenshot` (
    `id` VARCHAR(191) NOT NULL,
    `appCatalogItemId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GamePlaytime` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `gameKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NULL,
    `iconUrl` VARCHAR(500) NULL,
    `totalSeconds` INTEGER NOT NULL DEFAULT 0,
    `sessions` INTEGER NOT NULL DEFAULT 0,
    `firstPlayedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastPlayedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GamePlaytime_userId_lastPlayedAt_idx`(`userId`, `lastPlayedAt`),
    UNIQUE INDEX `GamePlaytime_userId_gameKey_key`(`userId`, `gameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegisteredGame` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `gameKey` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RegisteredGame_userId_gameKey_key`(`userId`, `gameKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `device` VARCHAR(191) NULL,
    `ipHash` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModGameMapping` (
    `id` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `modioNameId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ModGameMapping_steamAppId_key`(`steamAppId`),
    UNIQUE INDEX `ModGameMapping_modioGameId_key`(`modioGameId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkshopGameMapping` (
    `id` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NOT NULL,
    `workshopAppId` INTEGER NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `note` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WorkshopGameMapping_steamAppId_key`(`steamAppId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GameBananaGameMapping` (
    `id` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NOT NULL,
    `gameBananaGameId` INTEGER NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GameBananaGameMapping_steamAppId_key`(`steamAppId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ThunderstoreGameMapping` (
    `id` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NOT NULL,
    `communityIdentifier` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ThunderstoreGameMapping_steamAppId_key`(`steamAppId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModFavorite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModFavorite_modioModId_idx`(`modioModId`),
    UNIQUE INDEX `ModFavorite_userId_modioModId_key`(`userId`, `modioModId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModUp` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModUp_modioModId_idx`(`modioModId`),
    UNIQUE INDEX `ModUp_userId_modioModId_key`(`userId`, `modioModId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModComment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    INDEX `ModComment_modioModId_createdAt_idx`(`modioModId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModReport` (
    `id` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ModReport_modioModId_idx`(`modioModId`),
    INDEX `ModReport_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModProfile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ModProfile_userId_modioGameId_name_key`(`userId`, `modioGameId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModProfileItem` (
    `id` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NULL,
    `modioModfileId` INTEGER NULL,
    `modName` VARCHAR(191) NULL,
    `version` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `installedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ModProfileItem_profileId_modioModId_key`(`profileId`, `modioModId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModCollection` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModCollectionItem` (
    `id` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `modName` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `ModCollectionItem_collectionId_modioModId_key`(`collectionId`, `modioModId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedModpack` (
    `id` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `steamAppId` INTEGER NOT NULL,
    `gameName` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `coverUrl` VARCHAR(191) NULL,
    `items` MEDIUMTEXT NOT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `likeCount` INTEGER NOT NULL DEFAULT 0,
    `dislikeCount` INTEGER NOT NULL DEFAULT 0,
    `downloadCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SharedModpack_steamAppId_isPublic_idx`(`steamAppId`, `isPublic`),
    INDEX `SharedModpack_authorId_idx`(`authorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedModpackVote` (
    `id` VARCHAR(191) NOT NULL,
    `modpackId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SharedModpackVote_userId_idx`(`userId`),
    UNIQUE INDEX `SharedModpackVote_modpackId_userId_key`(`modpackId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SharedModpackDownload` (
    `id` VARCHAR(191) NOT NULL,
    `modpackId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SharedModpackDownload_userId_idx`(`userId`),
    UNIQUE INDEX `SharedModpackDownload_modpackId_userId_key`(`modpackId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventRsvp` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `startNotifiedAt` DATETIME(3) NULL,
    `remindedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EventRsvp_userId_idx`(`userId`),
    UNIQUE INDEX `EventRsvp_eventId_userId_key`(`eventId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `data` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ActivityEvent_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `ActivityEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityCheer` (
    `id` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityCheer_itemKey_idx`(`itemKey`),
    INDEX `ActivityCheer_ownerId_idx`(`ownerId`),
    UNIQUE INDEX `ActivityCheer_itemKey_userId_key`(`itemKey`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvatarDecoration` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `priceCoins` INTEGER NULL,
    `priceGems` INTEGER NULL,
    `scale` DOUBLE NOT NULL DEFAULT 1.2,
    `offsetX` DOUBLE NOT NULL DEFAULT 0,
    `offsetY` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `exclusiveTier` VARCHAR(16) NULL,
    `discountEligible` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `stock` INTEGER NULL,
    `sold` INTEGER NOT NULL DEFAULT 0,
    `tags` VARCHAR(200) NULL,
    `color` VARCHAR(16) NULL,
    `variantGroup` VARCHAR(64) NULL,
    `collectionId` VARCHAR(191) NULL,

    INDEX `AvatarDecoration_collectionId_idx`(`collectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserAvatarDecoration` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `decorationId` VARCHAR(191) NOT NULL,
    `serial` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserAvatarDecoration_decorationId_idx`(`decorationId`),
    UNIQUE INDEX `UserAvatarDecoration_userId_decorationId_key`(`userId`, `decorationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopCollection` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `bannerUrl` TEXT NULL,
    `logoUrl` TEXT NULL,
    `accentColor` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT true,
    `showInShop` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `bundlePriceCoins` INTEGER NULL,
    `bundlePriceGems` INTEGER NULL,
    `offerStartsAt` DATETIME(3) NULL,
    `offerEndsAt` DATETIME(3) NULL,
    `offerDiscount` INTEGER NULL,
    `discountEligible` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProfileEffect` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `priceCoins` INTEGER NULL,
    `priceGems` INTEGER NULL,
    `scale` DOUBLE NOT NULL DEFAULT 1,
    `offsetX` DOUBLE NOT NULL DEFAULT 0,
    `offsetY` DOUBLE NOT NULL DEFAULT 0,
    `opacity` DOUBLE NOT NULL DEFAULT 0.85,
    `duration` DOUBLE NOT NULL DEFAULT 4,
    `mScale` DOUBLE NOT NULL DEFAULT 1,
    `mOffsetX` DOUBLE NOT NULL DEFAULT 0,
    `mOffsetY` DOUBLE NOT NULL DEFAULT 0,
    `mOpacity` DOUBLE NOT NULL DEFAULT 0.85,
    `mDuration` DOUBLE NOT NULL DEFAULT 4,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `exclusiveTier` VARCHAR(16) NULL,
    `discountEligible` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `stock` INTEGER NULL,
    `sold` INTEGER NOT NULL DEFAULT 0,
    `tags` VARCHAR(200) NULL,
    `color` VARCHAR(16) NULL,
    `variantGroup` VARCHAR(64) NULL,
    `collectionId` VARCHAR(191) NULL,

    INDEX `ProfileEffect_collectionId_idx`(`collectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserProfileEffect` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `effectId` VARCHAR(191) NOT NULL,
    `serial` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserProfileEffect_effectId_idx`(`effectId`),
    UNIQUE INDEX `UserProfileEffect_userId_effectId_key`(`userId`, `effectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopItem` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `key` VARCHAR(64) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `previewUrl` TEXT NULL,
    `data` TEXT NULL,
    `priceCoins` INTEGER NULL,
    `priceGems` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `exclusiveTier` VARCHAR(16) NULL,
    `discountEligible` BOOLEAN NOT NULL DEFAULT true,
    `stock` INTEGER NULL,
    `sold` INTEGER NOT NULL DEFAULT 0,
    `tags` VARCHAR(200) NULL,
    `color` VARCHAR(16) NULL,
    `variantGroup` VARCHAR(64) NULL,
    `collectionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShopItem_key_key`(`key`),
    INDEX `ShopItem_kind_idx`(`kind`),
    INDEX `ShopItem_collectionId_idx`(`collectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserShopItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `serial` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserShopItem_itemId_idx`(`itemId`),
    UNIQUE INDEX `UserShopItem_userId_itemId_key`(`userId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemTrade` (
    `id` VARCHAR(191) NOT NULL,
    `fromUserId` VARCHAR(191) NOT NULL,
    `toUserId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `offer` TEXT NOT NULL,
    `request` TEXT NOT NULL,
    `message` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,

    INDEX `ItemTrade_fromUserId_status_idx`(`fromUserId`, `status`),
    INDEX `ItemTrade_toUserId_status_idx`(`toUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupporterAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `fromTier` VARCHAR(16) NOT NULL,
    `toTier` VARCHAR(16) NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupporterAuditLog_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `SupporterAuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mission` (
    `id` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL DEFAULT 'DAILY',
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `target` INTEGER NOT NULL DEFAULT 1,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `rewardGems` INTEGER NOT NULL DEFAULT 0,
    `rewardXp` INTEGER NOT NULL DEFAULT 0,
    `rewardItemKind` VARCHAR(16) NULL,
    `rewardItemId` VARCHAR(191) NULL,
    `rewardItemDays` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `position` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Mission_enabled_type_idx`(`enabled`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserMissionProgress` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `missionId` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `completedAt` DATETIME(3) NULL,
    `claimedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserMissionProgress_userId_periodKey_idx`(`userId`, `periodKey`),
    INDEX `UserMissionProgress_missionId_idx`(`missionId`),
    UNIQUE INDEX `UserMissionProgress_userId_missionId_periodKey_key`(`userId`, `missionId`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EconomyTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `gems` INTEGER NOT NULL DEFAULT 0,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EconomyTransaction_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserNote` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(256) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserNote_ownerId_targetId_key`(`ownerId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RedeemCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `note` VARCHAR(120) NULL,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `rewardGems` INTEGER NOT NULL DEFAULT 0,
    `itemKind` VARCHAR(16) NULL,
    `itemId` VARCHAR(191) NULL,
    `itemDays` INTEGER NULL,
    `maxUses` INTEGER NOT NULL DEFAULT 1,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RedeemCode_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RedeemCodeUse` (
    `id` VARCHAR(191) NOT NULL,
    `codeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RedeemCodeUse_userId_idx`(`userId`),
    UNIQUE INDEX `RedeemCodeUse_codeId_userId_key`(`codeId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SavedMessage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SavedMessage_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `SavedMessage_userId_messageId_key`(`userId`, `messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserIgnore` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserIgnore_userId_targetId_key`(`userId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopBanner` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `subtitle` VARCHAR(200) NULL,
    `imageUrl` TEXT NULL,
    `badge` VARCHAR(40) NULL,
    `buttonLabel` VARCHAR(30) NULL,
    `collectionId` VARCHAR(191) NULL,
    `accentColor` VARCHAR(16) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountSwitchToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountSwitchToken_tokenHash_key`(`tokenHash`),
    INDEX `AccountSwitchToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserNotice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(191) NULL,
    `data` TEXT NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserNotice_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `UserNotice_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `UserNotice_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SlugHistory` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SlugHistory_targetId_idx`(`targetId`),
    UNIQUE INDEX `SlugHistory_kind_slug_key`(`kind`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GalleryLike` (
    `id` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GalleryLike_itemKey_idx`(`itemKey`),
    INDEX `GalleryLike_userId_idx`(`userId`),
    UNIQUE INDEX `GalleryLike_itemKey_userId_key`(`itemKey`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GalleryAlbum` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GalleryAlbum_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GalleryAlbumItem` (
    `id` VARCHAR(191) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `addedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GalleryAlbumItem_albumId_createdAt_idx`(`albumId`, `createdAt`),
    UNIQUE INDEX `GalleryAlbumItem_albumId_itemKey_key`(`albumId`, `itemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GamePlayDay` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `gameKey` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `seconds` INTEGER NOT NULL DEFAULT 0,

    INDEX `GamePlayDay_userId_day_idx`(`userId`, `day`),
    UNIQUE INDEX `GamePlayDay_userId_gameKey_day_key`(`userId`, `gameKey`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeedMarker` (
    `key` VARCHAR(191) NOT NULL,
    `doneAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MinigameScore` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `game` VARCHAR(40) NOT NULL,
    `score` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MinigameScore_game_score_idx`(`game`, `score`),
    INDEX `MinigameScore_userId_game_idx`(`userId`, `game`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MinigameStat` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `game` VARCHAR(40) NOT NULL,
    `bestScore` INTEGER NOT NULL DEFAULT 0,
    `bestAt` DATETIME(3) NULL,
    `plays` INTEGER NOT NULL DEFAULT 0,
    `seconds` INTEGER NOT NULL DEFAULT 0,
    `lastPlayedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MinigameStat_game_bestScore_idx`(`game`, `bestScore`),
    INDEX `MinigameStat_userId_lastPlayedAt_idx`(`userId`, `lastPlayedAt`),
    UNIQUE INDEX `MinigameStat_userId_game_key`(`userId`, `game`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffAnnouncement` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `bannerUrl` TEXT NULL,
    `linkUrl` VARCHAR(500) NULL,
    `linkLabel` VARCHAR(60) NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `publishAt` DATETIME(3) NULL,
    `published` BOOLEAN NOT NULL DEFAULT true,

    INDEX `StaffAnnouncement_pinned_createdAt_idx`(`pinned`, `createdAt`),
    INDEX `StaffAnnouncement_published_publishAt_idx`(`published`, `publishAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardDef` (
    `id` VARCHAR(191) NOT NULL,
    `retired` BOOLEAN NOT NULL DEFAULT false,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `flavor` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `rarity` VARCHAR(191) NOT NULL DEFAULT 'COMUM',
    `element` VARCHAR(191) NOT NULL DEFAULT 'FOGO',
    `collection` VARCHAR(191) NOT NULL DEFAULT 'Origens',
    `cost` INTEGER NOT NULL DEFAULT 1,
    `attack` INTEGER NOT NULL DEFAULT 1,
    `health` INTEGER NOT NULL DEFAULT 1,
    `ability` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `abilityValue` INTEGER NOT NULL DEFAULT 0,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'UNIT',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardDef_slug_key`(`slug`),
    INDEX `CardDef_rarity_idx`(`rarity`),
    INDEX `CardDef_collection_idx`(`collection`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardPack` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#7c5cff',
    `priceCoins` INTEGER NULL,
    `priceGems` INTEGER NULL,
    `cardsPerPack` INTEGER NOT NULL DEFAULT 5,
    `weights` TEXT NOT NULL,
    `guaranteed` VARCHAR(191) NULL,
    `poolMode` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `poolCollection` VARCHAR(191) NULL,
    `poolCardIds` TEXT NULL,
    `dailyLimit` INTEGER NULL,
    `discountPercent` INTEGER NULL,
    `offerEndsAt` DATETIME(3) NULL,
    `expansion` BOOLEAN NOT NULL DEFAULT false,
    `availableUntil` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserCard` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `level` INTEGER NOT NULL DEFAULT 1,
    `foil` INTEGER NOT NULL DEFAULT 0,
    `golden` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserCard_cardId_idx`(`cardId`),
    UNIQUE INDEX `UserCard_userId_cardId_key`(`userId`, `cardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardDeck` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `cards` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CardDeck_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardPlayer` (
    `userId` VARCHAR(191) NOT NULL,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `pvpWins` INTEGER NOT NULL DEFAULT 0,
    `pvpLosses` INTEGER NOT NULL DEFAULT 0,
    `rating` INTEGER NOT NULL DEFAULT 1000,
    `coinsEarned` INTEGER NOT NULL DEFAULT 0,
    `packsOpened` INTEGER NOT NULL DEFAULT 0,
    `streak` INTEGER NOT NULL DEFAULT 0,
    `bestStreak` INTEGER NOT NULL DEFAULT 0,
    `rewardDay` VARCHAR(191) NULL,
    `rewardsToday` INTEGER NOT NULL DEFAULT 0,
    `starterClaimed` BOOLEAN NOT NULL DEFAULT false,
    `banned` BOOLEAN NOT NULL DEFAULT false,
    `seasonKey` VARCHAR(191) NULL,
    `seasonRating` INTEGER NOT NULL DEFAULT 1000,
    `seasonWins` INTEGER NOT NULL DEFAULT 0,
    `seasonLosses` INTEGER NOT NULL DEFAULT 0,
    `lastSeasonReward` TEXT NULL,
    `campaignStage` INTEGER NOT NULL DEFAULT 0,
    `duoWins` INTEGER NOT NULL DEFAULT 0,
    `duoLosses` INTEGER NOT NULL DEFAULT 0,
    `customPlayed` INTEGER NOT NULL DEFAULT 0,
    `brawlWeek` VARCHAR(191) NULL,
    `brawlWins` INTEGER NOT NULL DEFAULT 0,
    `tutorialDone` BOOLEAN NOT NULL DEFAULT false,
    `dust` INTEGER NOT NULL DEFAULT 0,
    `chestDay` VARCHAR(191) NULL,
    `chestWins` INTEGER NOT NULL DEFAULT 0,
    `chestsOpened` INTEGER NOT NULL DEFAULT 0,
    `streakDays` INTEGER NOT NULL DEFAULT 0,
    `lastPlayDay` VARCHAR(191) NULL,
    `equippedBack` VARCHAR(191) NULL,
    `equippedFrame` VARCHAR(191) NULL,
    `flawlessWins` INTEGER NOT NULL DEFAULT 0,
    `clutchWins` INTEGER NOT NULL DEFAULT 0,
    `draftRuns` INTEGER NOT NULL DEFAULT 0,
    `draftBest` INTEGER NOT NULL DEFAULT 0,
    `bossDamage` INTEGER NOT NULL DEFAULT 0,
    `kitV2` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CardPlayer_rating_idx`(`rating`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardDraft` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PICKING',
    `picks` TEXT NOT NULL,
    `options` TEXT NULL,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `losses` INTEGER NOT NULL DEFAULT 0,
    `fee` INTEGER NOT NULL DEFAULT 0,
    `reward` INTEGER NOT NULL DEFAULT 0,
    `matchId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `CardDraft_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardBoss` (
    `id` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `element` VARCHAR(191) NOT NULL,
    `hp` INTEGER NOT NULL,
    `damage` INTEGER NOT NULL DEFAULT 0,
    `defeatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CardBoss_weekKey_key`(`weekKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardBossHit` (
    `id` VARCHAR(191) NOT NULL,
    `bossId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `damage` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `day` VARCHAR(191) NULL,
    `dayTries` INTEGER NOT NULL DEFAULT 0,
    `claimed` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CardBossHit_bossId_damage_idx`(`bossId`, `damage`),
    UNIQUE INDEX `CardBossHit_bossId_userId_key`(`bossId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardClanWeek` (
    `id` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(191) NOT NULL,
    `results` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CardClanWeek_weekKey_key`(`weekKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardMatch` (
    `id` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(191) NOT NULL,
    `difficulty` VARCHAR(191) NULL,
    `p1Id` VARCHAR(191) NOT NULL,
    `p2Id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `winnerId` VARCHAR(191) NULL,
    `state` LONGTEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `turnDeadline` DATETIME(3) NULL,
    `reward1` INTEGER NOT NULL DEFAULT 0,
    `reward2` INTEGER NOT NULL DEFAULT 0,
    `endReason` VARCHAR(191) NULL,
    `initialState` LONGTEXT NULL,
    `actions` LONGTEXT NULL,
    `campaignStageId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `boardId` VARCHAR(191) NULL,
    `p3Id` VARCHAR(191) NULL,
    `p4Id` VARCHAR(191) NULL,
    `format` VARCHAR(191) NOT NULL DEFAULT '1V1',
    `custom` BOOLEAN NOT NULL DEFAULT false,
    `lobbyId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NULL,
    `reward3` INTEGER NOT NULL DEFAULT 0,
    `reward4` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,

    INDEX `CardMatch_p1Id_status_idx`(`p1Id`, `status`),
    INDEX `CardMatch_p2Id_status_idx`(`p2Id`, `status`),
    INDEX `CardMatch_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardTrade` (
    `id` VARCHAR(191) NOT NULL,
    `fromId` VARCHAR(191) NOT NULL,
    `toId` VARCHAR(191) NOT NULL,
    `offer` TEXT NOT NULL,
    `request` TEXT NOT NULL,
    `offerCoins` INTEGER NOT NULL DEFAULT 0,
    `requestCoins` INTEGER NOT NULL DEFAULT 0,
    `message` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `CardTrade_toId_status_idx`(`toId`, `status`),
    INDEX `CardTrade_fromId_status_idx`(`fromId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardPackOpen` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `packId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(191) NOT NULL,
    `cards` TEXT NOT NULL,
    `paidCoins` INTEGER NOT NULL DEFAULT 0,
    `paidGems` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CardPackOpen_userId_dayKey_idx`(`userId`, `dayKey`),
    INDEX `CardPackOpen_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardGameSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `data` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardStat` (
    `cardId` VARCHAR(191) NOT NULL,
    `played` INTEGER NOT NULL DEFAULT 0,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`cardId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardListing` (
    `id` VARCHAR(191) NOT NULL,
    `sellerId` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `foil` BOOLEAN NOT NULL DEFAULT false,
    `price` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `buyerId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `soldAt` DATETIME(3) NULL,

    INDEX `CardListing_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `CardListing_sellerId_status_idx`(`sellerId`, `status`),
    INDEX `CardListing_cardId_status_idx`(`cardId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardCampaignStage` (
    `id` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(191) NOT NULL,
    `story` TEXT NULL,
    `botName` VARCHAR(191) NOT NULL,
    `difficulty` VARCHAR(191) NOT NULL DEFAULT 'MEDIO',
    `heroHp` INTEGER NOT NULL DEFAULT 30,
    `deckCardIds` TEXT NULL,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `rewardCardId` VARCHAR(191) NULL,
    `boardId` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardTournament` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `maxPlayers` INTEGER NOT NULL DEFAULT 8,
    `prizeCoins` INTEGER NOT NULL DEFAULT 0,
    `prizeGems` INTEGER NOT NULL DEFAULT 0,
    `prizeCardId` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NULL,
    `bracket` LONGTEXT NULL,
    `winnerId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardTournamentEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CardTournamentEntry_userId_idx`(`userId`),
    UNIQUE INDEX `CardTournamentEntry_tournamentId_userId_key`(`tournamentId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardBoard` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `theme` VARCHAR(191) NOT NULL DEFAULT 'floresta',
    `imageUrl` TEXT NULL,
    `dim` INTEGER NOT NULL DEFAULT 35,
    `accent` VARCHAR(191) NOT NULL DEFAULT '#8b6bff',
    `effect` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `weight` INTEGER NOT NULL DEFAULT 10,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardLobby` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL DEFAULT '1V1',
    `custom` BOOLEAN NOT NULL DEFAULT false,
    `rules` TEXT NULL,
    `slots` TEXT NOT NULL,
    `boardId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `matchId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardLobby_code_key`(`code`),
    INDEX `CardLobby_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `CardLobby_hostId_idx`(`hostId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardPass` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `seasonKey` VARCHAR(191) NOT NULL,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `claimed` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardPass_userId_seasonKey_key`(`userId`, `seasonKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CardCosmetic` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `rarity` VARCHAR(191) NOT NULL DEFAULT 'COMUM',
    `priceGems` INTEGER NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'SHOP',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CardCosmetic_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserCardCosmetic` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `cosmeticId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserCardCosmetic_userId_idx`(`userId`),
    UNIQUE INDEX `UserCardCosmetic_userId_cosmeticId_key`(`userId`, `cosmeticId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ErrorLog` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `stack` TEXT NULL,
    `url` VARCHAR(512) NULL,
    `userAgent` VARCHAR(512) NULL,
    `userId` VARCHAR(191) NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `firstSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeen` DATETIME(3) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ErrorLog_fingerprint_key`(`fingerprint`),
    INDEX `ErrorLog_lastSeen_idx`(`lastSeen`),
    INDEX `ErrorLog_source_lastSeen_idx`(`source`, `lastSeen`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserActiveDay` (
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserActiveDay_day_idx`(`day`),
    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusIncident` (
    `id` VARCHAR(191) NOT NULL,
    `component` VARCHAR(32) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `detail` VARCHAR(300) NULL,

    INDEX `StatusIncident_component_startedAt_idx`(`component`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeasonPass` (
    `userId` VARCHAR(191) NOT NULL,
    `seasonKey` VARCHAR(7) NOT NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `claimedFree` VARCHAR(400) NOT NULL DEFAULT '[]',
    `claimedPlus` VARCHAR(400) NOT NULL DEFAULT '[]',
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SeasonPass_seasonKey_points_idx`(`seasonKey`, `points`),
    PRIMARY KEY (`userId`, `seasonKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Passkey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(512) NOT NULL,
    `publicKey` TEXT NOT NULL,
    `counter` INTEGER NOT NULL DEFAULT 0,
    `transports` VARCHAR(200) NULL,
    `name` VARCHAR(60) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Passkey_credentialId_key`(`credentialId`),
    INDEX `Passkey_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SectionSeen` (
    `userId` VARCHAR(191) NOT NULL,
    `section` VARCHAR(32) NOT NULL,
    `seenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `section`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserOnboardingStep` (
    `userId` VARCHAR(191) NOT NULL,
    `step` VARCHAR(32) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `claimedAt` DATETIME(3) NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `step`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DbBackup` (
    `id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `trigger` VARCHAR(16) NOT NULL,
    `method` VARCHAR(16) NULL,
    `location` VARCHAR(512) NULL,
    `fileName` VARCHAR(255) NULL,
    `sizeBytes` BIGINT NULL,
    `tables` INTEGER NULL,
    `rows` BIGINT NULL,
    `error` TEXT NULL,
    `startedBy` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `DbBackup_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DonationGoal` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `title` VARCHAR(80) NOT NULL DEFAULT 'Meta do mês',
    `description` VARCHAR(200) NULL,
    `target` INTEGER NOT NULL DEFAULT 0,
    `raised` INTEGER NOT NULL DEFAULT 0,
    `showDonors` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DonationEntry` (
    `id` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `donorName` VARCHAR(60) NULL,
    `note` VARCHAR(200) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DonationEntry_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PersonalSticker` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PersonalSticker_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RadioStation` (
    `channelId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `shuffle` BOOLEAN NOT NULL DEFAULT true,
    `playlist` TEXT NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`channelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FocusDay` (
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `minutes` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FocusDay_day_idx`(`day`),
    PRIMARY KEY (`userId`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntegrationConfig` (
    `key` VARCHAR(40) NOT NULL,
    `data` TEXT NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChannelWebhook` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `uses` INTEGER NOT NULL DEFAULT 0,

    INDEX `ChannelWebhook_channelId_idx`(`channelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QrLoginPairing` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `secretHash` VARCHAR(64) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `requesterIp` VARCHAR(64) NULL,
    `requesterUa` VARCHAR(400) NULL,
    `scannedById` VARCHAR(191) NULL,
    `scannedAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `QrLoginPairing_codeHash_key`(`codeHash`),
    UNIQUE INDEX `QrLoginPairing_secretHash_key`(`secretHash`),
    INDEX `QrLoginPairing_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PunishmentAppeal` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `punishmentKey` VARCHAR(120) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `until` DATETIME(3) NULL,
    `message` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `staffReply` TEXT NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PunishmentAppeal_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PunishmentAppeal_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `PunishmentAppeal_userId_punishmentKey_key`(`userId`, `punishmentKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModRating` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modioModId` INTEGER NOT NULL,
    `modioGameId` INTEGER NOT NULL,
    `stars` INTEGER NOT NULL,
    `review` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ModRating_modioModId_idx`(`modioModId`),
    INDEX `ModRating_modioGameId_idx`(`modioGameId`),
    UNIQUE INDEX `ModRating_userId_modioModId_key`(`userId`, `modioModId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobRun` (
    `key` VARCHAR(64) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `doneAt` DATETIME(3) NULL,
    `info` VARCHAR(500) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RewardGrant` (
    `key` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RewardGrant_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`key`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityCounter` (
    `scope` VARCHAR(16) NOT NULL,
    `scopeId` VARCHAR(64) NOT NULL,
    `periodKey` VARCHAR(10) NOT NULL,
    `messages` INTEGER NOT NULL DEFAULT 0,
    `voiceMinutes` INTEGER NOT NULL DEFAULT 0,
    `forumPosts` INTEGER NOT NULL DEFAULT 0,
    `reactions` INTEGER NOT NULL DEFAULT 0,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityCounter_scope_periodKey_points_idx`(`scope`, `periodKey`, `points`),
    PRIMARY KEY (`scope`, `scopeId`, `periodKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClanWeekResult` (
    `weekKey` VARCHAR(10) NOT NULL,
    `clanId` VARCHAR(191) NULL,
    `clanName` VARCHAR(100) NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `membersRewarded` INTEGER NOT NULL DEFAULT 0,
    `standings` TEXT NULL,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`weekKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferralCode` (
    `userId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReferralCode_code_key`(`code`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Referral` (
    `id` VARCHAR(191) NOT NULL,
    `inviterId` VARCHAR(191) NOT NULL,
    `inviteeId` VARCHAR(191) NULL,
    `applicationId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `inviteeIp` VARCHAR(64) NULL,
    `note` VARCHAR(160) NULL,
    `monthKey` VARCHAR(7) NULL,
    `inviterCoins` INTEGER NOT NULL DEFAULT 0,
    `inviteeCoins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `rewardedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Referral_inviteeId_key`(`inviteeId`),
    UNIQUE INDEX `Referral_applicationId_key`(`applicationId`),
    INDEX `Referral_inviterId_status_idx`(`inviterId`, `status`),
    INDEX `Referral_inviterId_monthKey_idx`(`inviterId`, `monthKey`),
    INDEX `Referral_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonthlyRecap` (
    `userId` VARCHAR(191) NOT NULL,
    `monthKey` VARCHAR(7) NOT NULL,
    `data` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MonthlyRecap_monthKey_idx`(`monthKey`),
    PRIMARY KEY (`userId`, `monthKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostOfWeek` (
    `weekKey` VARCHAR(10) NOT NULL,
    `postId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PostOfWeek_postId_idx`(`postId`),
    PRIMARY KEY (`weekKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RaffleTicket` (
    `id` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(10) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `spent` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RaffleTicket_weekKey_idx`(`weekKey`),
    UNIQUE INDEX `RaffleTicket_weekKey_userId_key`(`weekKey`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RaffleDraw` (
    `weekKey` VARCHAR(10) NOT NULL,
    `winnerId` VARCHAR(191) NULL,
    `prize` INTEGER NOT NULL DEFAULT 0,
    `tickets` INTEGER NOT NULL DEFAULT 0,
    `participants` INTEGER NOT NULL DEFAULT 0,
    `drawnAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`weekKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlayGroup` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `game` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `slots` INTEGER NOT NULL DEFAULT 4,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `fullNotifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlayGroup_status_startsAt_idx`(`status`, `startsAt`),
    INDEX `PlayGroup_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlayGroupMember` (
    `id` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `remindedAt` DATETIME(3) NULL,

    INDEX `PlayGroupMember_userId_idx`(`userId`),
    UNIQUE INDEX `PlayGroupMember_groupId_userId_key`(`groupId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommunityGoal` (
    `id` VARCHAR(191) NOT NULL,
    `weekKey` VARCHAR(10) NOT NULL,
    `metric` VARCHAR(16) NOT NULL,
    `target` INTEGER NOT NULL,
    `rewardCoins` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(120) NULL,
    `reachedAt` DATETIME(3) NULL,
    `rewardedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CommunityGoal_weekKey_metric_key`(`weekKey`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SeasonClaim` (
    `userId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(10) NOT NULL,
    `season` VARCHAR(16) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SeasonClaim_season_idx`(`season`),
    PRIMARY KEY (`userId`, `dayKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Coupon` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(8) NOT NULL DEFAULT 'PERCENT',
    `value` INTEGER NOT NULL,
    `maxUses` INTEGER NULL,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `minPrice` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `note` VARCHAR(120) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Coupon_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CouponUse` (
    `id` VARCHAR(191) NOT NULL,
    `couponId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `discount` INTEGER NOT NULL DEFAULT 0,
    `target` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CouponUse_userId_idx`(`userId`),
    UNIQUE INDEX `CouponUse_couponId_userId_key`(`couponId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReputationThanks` (
    `id` VARCHAR(191) NOT NULL,
    `giverId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(8) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReputationThanks_receiverId_createdAt_idx`(`receiverId`, `createdAt`),
    UNIQUE INDEX `ReputationThanks_giverId_receiverId_dayKey_key`(`giverId`, `receiverId`, `dayKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoinTip` (
    `id` VARCHAR(191) NOT NULL,
    `fromId` VARCHAR(191) NOT NULL,
    `toId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `messageId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CoinTip_fromId_createdAt_idx`(`fromId`, `createdAt`),
    INDEX `CoinTip_toId_createdAt_idx`(`toId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TipDaily` (
    `userId` VARCHAR(191) NOT NULL,
    `dayKey` VARCHAR(10) NOT NULL,
    `sent` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `dayKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetPenguin` (
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(24) NOT NULL DEFAULT 'Pingo',
    `color` VARCHAR(16) NOT NULL DEFAULT 'blue',
    `stage` INTEGER NOT NULL DEFAULT 0,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `streak` INTEGER NOT NULL DEFAULT 0,
    `bestStreak` INTEGER NOT NULL DEFAULT 0,
    `careCount` INTEGER NOT NULL DEFAULT 0,
    `lastCareDay` VARCHAR(10) NULL,
    `lastCaredAt` DATETIME(3) NULL,
    `equipped` VARCHAR(400) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PetAccessoryOwned` (
    `userId` VARCHAR(191) NOT NULL,
    `accessoryId` VARCHAR(32) NOT NULL,
    `pricePaid` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `accessoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreatorItem` (
    `id` VARCHAR(191) NOT NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `description` VARCHAR(200) NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `priceCoins` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `rejectReason` VARCHAR(300) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `decorationId` VARCHAR(191) NULL,
    `sales` INTEGER NOT NULL DEFAULT 0,
    `earnings` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CreatorItem_status_kind_idx`(`status`, `kind`),
    INDEX `CreatorItem_creatorId_idx`(`creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreatorPurchase` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `buyerId` VARCHAR(191) NOT NULL,
    `pricePaid` INTEGER NOT NULL,
    `fee` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CreatorPurchase_buyerId_idx`(`buyerId`),
    UNIQUE INDEX `CreatorPurchase_itemId_buyerId_key`(`itemId`, `buyerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreatorItemReport` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `reporterId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CreatorItemReport_status_idx`(`status`),
    UNIQUE INDEX `CreatorItemReport_itemId_reporterId_key`(`itemId`, `reporterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WikiPage` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `category` VARCHAR(60) NOT NULL DEFAULT 'Geral',
    `body` TEXT NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WikiPage_slug_key`(`slug`),
    INDEX `WikiPage_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinguConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `welcomeEnabled` BOOLEAN NOT NULL DEFAULT true,
    `welcomeChannelId` VARCHAR(191) NULL,
    `welcomeTemplate` TEXT NULL,
    `welcomeAi` BOOLEAN NOT NULL DEFAULT false,
    `modAssistEnabled` BOOLEAN NOT NULL DEFAULT true,
    `modAssistAi` BOOLEAN NOT NULL DEFAULT true,
    `modExtraWords` TEXT NULL,
    `summaryEnabled` BOOLEAN NOT NULL DEFAULT true,
    `translateEnabled` BOOLEAN NOT NULL DEFAULT true,
    `quizDailyEnabled` BOOLEAN NOT NULL DEFAULT false,
    `quizChannelId` VARCHAR(191) NULL,
    `quizHour` INTEGER NOT NULL DEFAULT 20,
    `quizWindowSec` INTEGER NOT NULL DEFAULT 60,
    `quizCoins` INTEGER NOT NULL DEFAULT 20,
    `quizXp` INTEGER NOT NULL DEFAULT 30,
    `quizLastDailyDay` VARCHAR(10) NULL,
    `imageEnabled` BOOLEAN NOT NULL DEFAULT true,
    `imageDailyLimit` INTEGER NOT NULL DEFAULT 10,
    `imageCooldownSec` INTEGER NOT NULL DEFAULT 30,
    `imageConcurrency` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinguImage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NULL,
    `sourceMessageId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `prompt` TEXT NOT NULL,
    `finalPrompt` TEXT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `seed` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `url` VARCHAR(500) NULL,
    `storageKey` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `PinguImage_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `PinguImage_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PinguImage_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinguQuizQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `answers` TEXT NOT NULL,
    `category` VARCHAR(40) NOT NULL DEFAULT 'Geral',
    `status` VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
    `source` VARCHAR(16) NOT NULL DEFAULT 'STAFF',
    `createdBy` VARCHAR(191) NULL,
    `timesAsked` INTEGER NOT NULL DEFAULT 0,
    `lastAskedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PinguQuizQuestion_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinguQuizRound` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NULL,
    `question` VARCHAR(300) NOT NULL,
    `startedBy` VARCHAR(191) NULL,
    `winnerId` VARCHAR(191) NULL,
    `answeredAt` DATETIME(3) NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `endsAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PinguQuizRound_winnerId_idx`(`winnerId`),
    INDEX `PinguQuizRound_channelId_createdAt_idx`(`channelId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PinguModAlert` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `reasons` TEXT NOT NULL,
    `snippet` TEXT NOT NULL,
    `aiVerdict` VARCHAR(8) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PinguModAlert_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PinguModAlert_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaddleNewsText` (
    `key` VARCHAR(40) NOT NULL,
    `en` TEXT NOT NULL,
    `pt` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaddlePenguin` (
    `id` INTEGER NOT NULL,
    `userId` VARCHAR(191) NULL,
    `name` VARCHAR(32) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WaddlePenguin_userId_key`(`userId`),
    UNIQUE INDEX `WaddlePenguin_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaEvent` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(60) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `currencyName` VARCHAR(40) NOT NULL DEFAULT 'Fichas',
    `party` VARCHAR(80) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `config` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlazaEvent_slug_key`(`slug`),
    INDEX `PlazaEvent_active_startsAt_endsAt_idx`(`active`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaEventWallet` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `earned` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `PlazaEventWallet_userId_eventId_key`(`userId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaQuestProgress` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `questKey` VARCHAR(60) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `done` BOOLEAN NOT NULL DEFAULT false,
    `claimedAt` DATETIME(3) NULL,
    `data` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlazaQuestProgress_userId_eventId_idx`(`userId`, `eventId`),
    UNIQUE INDEX `PlazaQuestProgress_userId_eventId_questKey_key`(`userId`, `eventId`, `questKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaEventPurchase` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `shopKey` VARCHAR(60) NOT NULL,
    `price` INTEGER NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaEventPurchase_userId_eventId_shopKey_key`(`userId`, `eventId`, `shopKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaDonation` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaDonation_eventId_createdAt_idx`(`eventId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaCode` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `label` VARCHAR(120) NOT NULL DEFAULT '',
    `coins` INTEGER NOT NULL DEFAULT 0,
    `eventCoins` INTEGER NOT NULL DEFAULT 0,
    `eventSlug` VARCHAR(60) NULL,
    `items` VARCHAR(4000) NOT NULL DEFAULT '[]',
    `maxUses` INTEGER NULL,
    `uses` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaCode_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaCodeUse` (
    `id` VARCHAR(191) NOT NULL,
    `codeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaCodeUse_codeId_userId_key`(`codeId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaMascotVisit` (
    `id` VARCHAR(191) NOT NULL,
    `mascotKey` VARCHAR(40) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `mascotUserId` VARCHAR(191) NULL,
    `room` INTEGER NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `backgroundItemId` INTEGER NULL,
    `itemIds` VARCHAR(4000) NOT NULL DEFAULT '[]',
    `coins` INTEGER NOT NULL DEFAULT 0,
    `eventCoins` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(200) NOT NULL DEFAULT '',
    `surprise` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaMascotVisit_startsAt_endsAt_idx`(`startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaMascotMeet` (
    `id` VARCHAR(191) NOT NULL,
    `visitId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaMascotMeet_visitId_userId_key`(`visitId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaAdventClaim` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `day` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaAdventClaim_userId_year_day_key`(`userId`, `year`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaContest` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'igloo',
    `title` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NOT NULL DEFAULT '',
    `theme` VARCHAR(120) NOT NULL DEFAULT '',
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `votingEndsAt` DATETIME(3) NOT NULL,
    `prizeItems` VARCHAR(4000) NOT NULL DEFAULT '[]',
    `prizeCoins` INTEGER NOT NULL DEFAULT 0,
    `maxWinners` INTEGER NOT NULL DEFAULT 3,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaContest_active_startsAt_votingEndsAt_idx`(`active`, `startsAt`, `votingEndsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaContestEntry` (
    `id` VARCHAR(191) NOT NULL,
    `contestId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `caption` VARCHAR(200) NOT NULL DEFAULT '',
    `votes` INTEGER NOT NULL DEFAULT 0,
    `winner` BOOLEAN NOT NULL DEFAULT false,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaContestEntry_contestId_votes_idx`(`contestId`, `votes`),
    UNIQUE INDEX `PlazaContestEntry_contestId_userId_key`(`contestId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaContestVote` (
    `id` VARCHAR(191) NOT NULL,
    `contestId` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlazaContestVote_contestId_userId_key`(`contestId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaPuzzle` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `authorId` VARCHAR(191) NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `solves` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaPuzzle_approved_active_idx`(`approved`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaPuzzleSolve` (
    `id` VARCHAR(191) NOT NULL,
    `puzzleId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(10) NOT NULL,
    `seconds` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaPuzzleSolve_userId_idx`(`userId`),
    UNIQUE INDEX `PlazaPuzzleSolve_puzzleId_userId_mode_key`(`puzzleId`, `userId`, `mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaPuzzleCompletion` (
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaSetting` (
    `key` VARCHAR(40) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlazaAsset` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `target` VARCHAR(200) NOT NULL,
    `file` VARCHAR(200) NOT NULL,
    `label` VARCHAR(120) NOT NULL DEFAULT '',
    `source` VARCHAR(500) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlazaAsset_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_selectedPendantId_fkey` FOREIGN KEY (`selectedPendantId`) REFERENCES `Pendant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_relationshipPartnerId_fkey` FOREIGN KEY (`relationshipPartnerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clanTagId_fkey` FOREIGN KEY (`clanTagId`) REFERENCES `ClanTag`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_featuredModpackId_fkey` FOREIGN KEY (`featuredModpackId`) REFERENCES `SharedModpack`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileVote` ADD CONSTRAINT `ProfileVote_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileVote` ADD CONSTRAINT `ProfileVote_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserBadge` ADD CONSTRAINT `UserBadge_badgeId_fkey` FOREIGN KEY (`badgeId`) REFERENCES `Badge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FavoriteGif` ADD CONSTRAINT `FavoriteGif_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformAnnouncement` ADD CONSTRAINT `PlatformAnnouncement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnnouncementDismissal` ADD CONSTRAINT `AnnouncementDismissal_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `PlatformAnnouncement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UpdateLogEntry` ADD CONSTRAINT `UpdateLogEntry_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OAuthAccount` ADD CONSTRAINT `OAuthAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TwoFactorRecoveryCode` ADD CONSTRAINT `TwoFactorRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushToken` ADD CONSTRAINT `PushToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebPushSubscription` ADD CONSTRAINT `WebPushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledMessage` ADD CONSTRAINT `ScheduledMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MinigameWeeklyPrize` ADD CONSTRAINT `MinigameWeeklyPrize_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailVerificationCode` ADD CONSTRAINT `EmailVerificationCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Friendship` ADD CONSTRAINT `Friendship_addresseeId_fkey` FOREIGN KEY (`addresseeId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Testimonial` ADD CONSTRAINT `Testimonial_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Testimonial` ADD CONSTRAINT `Testimonial_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Scrap` ADD CONSTRAINT `Scrap_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Scrap` ADD CONSTRAINT `Scrap_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fan` ADD CONSTRAINT `Fan_fanId_fkey` FOREIGN KEY (`fanId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Fan` ADD CONSTRAINT `Fan_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RankingVote` ADD CONSTRAINT `RankingVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RankingVote` ADD CONSTRAINT `RankingVote_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileVisit` ADD CONSTRAINT `ProfileVisit_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileVisit` ADD CONSTRAINT `ProfileVisit_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Photo` ADD CONSTRAINT `Photo_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotoComment` ADD CONSTRAINT `PhotoComment_photoId_fkey` FOREIGN KEY (`photoId`) REFERENCES `Photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotoComment` ADD CONSTRAINT `PhotoComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TraitVote` ADD CONSTRAINT `TraitVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TraitVote` ADD CONSTRAINT `TraitVote_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RelationshipRequest` ADD CONSTRAINT `RelationshipRequest_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RelationshipRequest` ADD CONSTRAINT `RelationshipRequest_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePoll` ADD CONSTRAINT `ProfilePoll_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePoll` ADD CONSTRAINT `ProfilePoll_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePollOption` ADD CONSTRAINT `ProfilePollOption_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `ProfilePoll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePollVote` ADD CONSTRAINT `ProfilePollVote_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `ProfilePoll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePollVote` ADD CONSTRAINT `ProfilePollVote_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `ProfilePollOption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfilePollVote` ADD CONSTRAINT `ProfilePollVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationMember` ADD CONSTRAINT `ConversationMember_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConversationMember` ADD CONSTRAINT `ConversationMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Channel` ADD CONSTRAINT `Channel_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PermissionOverwrite` ADD CONSTRAINT `PermissionOverwrite_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PermissionOverwrite` ADD CONSTRAINT `PermissionOverwrite_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationOverride` ADD CONSTRAINT `NotificationOverride_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationOverride` ADD CONSTRAINT `NotificationOverride_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationOverride` ADD CONSTRAINT `NotificationOverride_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChannelReadState` ADD CONSTRAINT `ChannelReadState_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChannelReadState` ADD CONSTRAINT `ChannelReadState_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emoji` ADD CONSTRAINT `Emoji_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `AssetCollection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emoji` ADD CONSTRAINT `Emoji_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sticker` ADD CONSTRAINT `Sticker_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `AssetCollection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sticker` ADD CONSTRAINT `Sticker_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SoundboardSound` ADD CONSTRAINT `SoundboardSound_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `Channel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_replyToId_fkey` FOREIGN KEY (`replyToId`) REFERENCES `Message`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `MessageEdit` ADD CONSTRAINT `MessageEdit_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `AutomodFlag` ADD CONSTRAINT `AutomodFlag_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutomodFlag` ADD CONSTRAINT `AutomodFlag_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Report` ADD CONSTRAINT `Report_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageMention` ADD CONSTRAINT `MessageMention_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `Reaction` ADD CONSTRAINT `Reaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warning` ADD CONSTRAINT `Warning_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Furniture` ADD CONSTRAINT `Furniture_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `FurnitureCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserFurniture` ADD CONSTRAINT `UserFurniture_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserFurniture` ADD CONSTRAINT `UserFurniture_furnitureId_fkey` FOREIGN KEY (`furnitureId`) REFERENCES `Furniture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseCatalog` ADD CONSTRAINT `HouseCatalog_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `HouseGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserHouse` ADD CONSTRAINT `UserHouse_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserHouse` ADD CONSTRAINT `UserHouse_houseId_fkey` FOREIGN KEY (`houseId`) REFERENCES `HouseCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserHouse` ADD CONSTRAINT `UserHouse_mapBackgroundId_fkey` FOREIGN KEY (`mapBackgroundId`) REFERENCES `MapBackground`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMapBackground` ADD CONSTRAINT `UserMapBackground_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMapBackground` ADD CONSTRAINT `UserMapBackground_mapBackgroundId_fkey` FOREIGN KEY (`mapBackgroundId`) REFERENCES `MapBackground`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseLike` ADD CONSTRAINT `HouseLike_userHouseId_fkey` FOREIGN KEY (`userHouseId`) REFERENCES `UserHouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseLike` ADD CONSTRAINT `HouseLike_likerId_fkey` FOREIGN KEY (`likerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseComment` ADD CONSTRAINT `HouseComment_userHouseId_fkey` FOREIGN KEY (`userHouseId`) REFERENCES `UserHouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseComment` ADD CONSTRAINT `HouseComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlacedFurniture` ADD CONSTRAINT `PlacedFurniture_userHouseId_fkey` FOREIGN KEY (`userHouseId`) REFERENCES `UserHouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlacedFurniture` ADD CONSTRAINT `PlacedFurniture_furnitureId_fkey` FOREIGN KEY (`furnitureId`) REFERENCES `Furniture`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectibleSticker` ADD CONSTRAINT `CollectibleSticker_rarityId_fkey` FOREIGN KEY (`rarityId`) REFERENCES `StickerRarity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSticker` ADD CONSTRAINT `UserSticker_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSticker` ADD CONSTRAINT `UserSticker_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `CollectibleSticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerAlbum` ADD CONSTRAINT `UserStickerAlbum_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserStickerAlbum` ADD CONSTRAINT `UserStickerAlbum_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `CollectibleSticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerCapsule` ADD CONSTRAINT `StickerCapsule_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StickerCapsule` ADD CONSTRAINT `StickerCapsule_stickerId_fkey` FOREIGN KEY (`stickerId`) REFERENCES `CollectibleSticker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAchievement` ADD CONSTRAINT `UserAchievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_claimedById_fkey` FOREIGN KEY (`claimedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Community` ADD CONSTRAINT `Community_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostCategory` ADD CONSTRAINT `PostCategory_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `Community`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `PostCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostVote` ADD CONSTRAINT `PostVote_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostVote` ADD CONSTRAINT `PostVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostComment` ADD CONSTRAINT `PostComment_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostComment` ADD CONSTRAINT `PostComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostComment` ADD CONSTRAINT `PostComment_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `PostComment`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `PostCommentVote` ADD CONSTRAINT `PostCommentVote_commentId_fkey` FOREIGN KEY (`commentId`) REFERENCES `PostComment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostCommentVote` ADD CONSTRAINT `PostCommentVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Clan` ADD CONSTRAINT `Clan_iconId_fkey` FOREIGN KEY (`iconId`) REFERENCES `ClanIcon`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanTag` ADD CONSTRAINT `ClanTag_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanJoinRequest` ADD CONSTRAINT `ClanJoinRequest_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanJoinRequest` ADD CONSTRAINT `ClanJoinRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanInvite` ADD CONSTRAINT `ClanInvite_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanInvite` ADD CONSTRAINT `ClanInvite_invitedUserId_fkey` FOREIGN KEY (`invitedUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanInvite` ADD CONSTRAINT `ClanInvite_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanMessage` ADD CONSTRAINT `ClanMessage_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClanMessage` ADD CONSTRAINT `ClanMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSettings` ADD CONSTRAINT `UserSettings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserShortcut` ADD CONSTRAINT `UserShortcut_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConnectedAccount` ADD CONSTRAINT `ConnectedAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppScreenshot` ADD CONSTRAINT `AppScreenshot_appCatalogItemId_fkey` FOREIGN KEY (`appCatalogItemId`) REFERENCES `AppCatalogItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GamePlaytime` ADD CONSTRAINT `GamePlaytime_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegisteredGame` ADD CONSTRAINT `RegisteredGame_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityLog` ADD CONSTRAINT `SecurityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModFavorite` ADD CONSTRAINT `ModFavorite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModUp` ADD CONSTRAINT `ModUp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModComment` ADD CONSTRAINT `ModComment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModReport` ADD CONSTRAINT `ModReport_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModProfile` ADD CONSTRAINT `ModProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModProfileItem` ADD CONSTRAINT `ModProfileItem_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ModProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModCollection` ADD CONSTRAINT `ModCollection_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModCollectionItem` ADD CONSTRAINT `ModCollectionItem_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `ModCollection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedModpack` ADD CONSTRAINT `SharedModpack_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedModpackVote` ADD CONSTRAINT `SharedModpackVote_modpackId_fkey` FOREIGN KEY (`modpackId`) REFERENCES `SharedModpack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedModpackVote` ADD CONSTRAINT `SharedModpackVote_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedModpackDownload` ADD CONSTRAINT `SharedModpackDownload_modpackId_fkey` FOREIGN KEY (`modpackId`) REFERENCES `SharedModpack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SharedModpackDownload` ADD CONSTRAINT `SharedModpackDownload_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventRsvp` ADD CONSTRAINT `EventRsvp_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvatarDecoration` ADD CONSTRAINT `AvatarDecoration_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `ShopCollection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserAvatarDecoration` ADD CONSTRAINT `UserAvatarDecoration_decorationId_fkey` FOREIGN KEY (`decorationId`) REFERENCES `AvatarDecoration`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProfileEffect` ADD CONSTRAINT `ProfileEffect_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `ShopCollection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserProfileEffect` ADD CONSTRAINT `UserProfileEffect_effectId_fkey` FOREIGN KEY (`effectId`) REFERENCES `ProfileEffect`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopItem` ADD CONSTRAINT `ShopItem_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `ShopCollection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserShopItem` ADD CONSTRAINT `UserShopItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `ShopItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMissionProgress` ADD CONSTRAINT `UserMissionProgress_missionId_fkey` FOREIGN KEY (`missionId`) REFERENCES `Mission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RedeemCodeUse` ADD CONSTRAINT `RedeemCodeUse_codeId_fkey` FOREIGN KEY (`codeId`) REFERENCES `RedeemCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GalleryAlbumItem` ADD CONSTRAINT `GalleryAlbumItem_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `GalleryAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModRating` ADD CONSTRAINT `ModRating_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaEventWallet` ADD CONSTRAINT `PlazaEventWallet_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `PlazaEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaQuestProgress` ADD CONSTRAINT `PlazaQuestProgress_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `PlazaEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaEventPurchase` ADD CONSTRAINT `PlazaEventPurchase_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `PlazaEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaDonation` ADD CONSTRAINT `PlazaDonation_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `PlazaEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaCodeUse` ADD CONSTRAINT `PlazaCodeUse_codeId_fkey` FOREIGN KEY (`codeId`) REFERENCES `PlazaCode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaMascotMeet` ADD CONSTRAINT `PlazaMascotMeet_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `PlazaMascotVisit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaContestEntry` ADD CONSTRAINT `PlazaContestEntry_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `PlazaContest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaContestVote` ADD CONSTRAINT `PlazaContestVote_contestId_fkey` FOREIGN KEY (`contestId`) REFERENCES `PlazaContest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaContestVote` ADD CONSTRAINT `PlazaContestVote_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `PlazaContestEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlazaPuzzleSolve` ADD CONSTRAINT `PlazaPuzzleSolve_puzzleId_fkey` FOREIGN KEY (`puzzleId`) REFERENCES `PlazaPuzzle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- 21/11/2026 (main: cartão da carteira) — adicionado à mão até gerar de novo
ALTER TABLE `User` ADD COLUMN `walletCardStyle` VARCHAR(16) NULL;

CREATE TABLE `WalletCardShare` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `gems` INTEGER NOT NULL DEFAULT 0,
    `level` INTEGER NOT NULL DEFAULT 1,
    `style` VARCHAR(16) NOT NULL DEFAULT 'DEFAULT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WalletCardShare_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
