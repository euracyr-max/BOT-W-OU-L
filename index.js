require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require("discord.js");

const CHANNEL_ID = "1494917893006037064";
const REACTIONS = [
  "<:emoji_55:1494919595382018171>",
  "<:emoji_57:1494919645105487972>",
  "<:emoji_56:1494919624318517320>",
];
const REACTION_IDS = new Set(["1494919595382018171", "1494919645105487972", "1494919624318517320"]);
const HISTORY_SCAN_DELAY_MS = 1_000;
const REACTION_DELAY_MS = 750;
const PERIODIC_CHECK_MS = 60_000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getEmojiId(emoji) {
  const match = emoji.match(/:(\d+)>$/);
  return match ? match[1] : emoji;
}

function getReaction(message, emoji) {
  const emojiId = getEmojiId(emoji);
  return message.reactions.cache.find((reaction) => {
    return reaction.emoji.id === emojiId || reaction.emoji.name === emojiId;
  });
}

async function botAlreadyReacted(message, emoji) {
  const reaction = getReaction(message, emoji);

  if (!reaction) {
    return false;
  }

  if (reaction.me) {
    return true;
  }

  try {
    const users = await reaction.users.fetch();
    return users.has(client.user.id);
  } catch {
    return false;
  }
}

async function fetchCompleteMessage(message) {
  if (!message) {
    return null;
  }

  try {
    return message.partial ? await message.fetch() : message;
  } catch {
    return null;
  }
}

async function shouldHandleMessage(message) {
  const fullMessage = await fetchCompleteMessage(message);

  if (!fullMessage) {
    return null;
  }

  if (fullMessage.channelId !== CHANNEL_ID) {
    return null;
  }

  if (fullMessage.author?.bot) {
    return null;
  }

  return fullMessage;
}

async function ensureReactions(message) {
  const fullMessage = await shouldHandleMessage(message);

  if (!fullMessage) {
    return;
  }

  for (const emoji of REACTIONS) {
    try {
      const hasReaction = await botAlreadyReacted(fullMessage, emoji);

      if (!hasReaction) {
        await fullMessage.react(emoji);
        await sleep(REACTION_DELAY_MS);
      }
    } catch (error) {
      if (![10008, 10014, 50001, 50013].includes(error.code)) {
        console.error(`Failed to react to message ${fullMessage.id}:`, error);
      }
    }
  }
}

async function scanChannelHistory(channel) {
  let before;

  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, before });

    if (!messages.size) {
      break;
    }

    for (const message of messages.values()) {
      await ensureReactions(message);
    }

    before = messages.last().id;
    await sleep(HISTORY_SCAN_DELAY_MS);
  }
}

async function scanRecentMessages() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel?.isTextBased() || !channel.messages) {
      console.error(`Channel ${CHANNEL_ID} is not available as a text channel.`);
      return;
    }

    const messages = await channel.messages.fetch({ limit: 100 });

    for (const message of messages.values()) {
      await ensureReactions(message);
    }
  } catch (error) {
    console.error("Failed to scan recent messages:", error);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    if (!channel?.isTextBased() || !channel.messages) {
      console.error(`Channel ${CHANNEL_ID} is not available as a text channel.`);
      return;
    }

    await scanChannelHistory(channel);
    setInterval(scanRecentMessages, PERIODIC_CHECK_MS);
  } catch (error) {
    console.error("Failed during startup channel scan:", error);
  }
});

client.on(Events.MessageCreate, ensureReactions);

client.on(Events.MessageReactionRemove, async (reaction) => {
  const fullReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;

  if (!fullReaction) {
    return;
  }

  if (fullReaction.message.channelId !== CHANNEL_ID) {
    return;
  }

  if (REACTION_IDS.has(fullReaction.emoji.id) || REACTION_IDS.has(fullReaction.emoji.name)) {
    await ensureReactions(fullReaction.message);
  }
});

client.on(Events.MessageReactionRemoveEmoji, async (reaction) => {
  if (reaction.message.channelId === CHANNEL_ID) {
    await ensureReactions(reaction.message);
  }
});

client.on(Events.MessageReactionRemoveAll, async (message) => {
  if (message.channelId === CHANNEL_ID) {
    await ensureReactions(message);
  }
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

if (!process.env.TOKEN) {
  console.error("Missing TOKEN environment variable.");
  process.exit(1);
}

client.login(process.env.TOKEN);
