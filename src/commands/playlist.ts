"use strict"

import * as _      from 'lodash';
import * as Utils  from '../libs/common/Utils';
import * as Embeds from '../libs/common/Embeds';

import { BotConfig, Daos, Track } from '../typings';
import { DiscordBot }           from '../libs/DiscordBot';
import { YoutubeAPI }           from '../libs/api/YoutubeAPI';
import { SoundCloudAPI }        from '../libs/api/SoundCloudAPI';
import { Message, TextChannel, Attachment } from 'discord.js';
import { Readable } from 'stream';

export function addPlaylistCommands(bot: DiscordBot, config: BotConfig, daos: Daos) {
  const users = daos.users;
  const scUsers = daos.soundCloudUsers;
  const ytApi = new YoutubeAPI(config.tokens.youtube);
  const scApi = new SoundCloudAPI(config.tokens.soundcloud);

  const commands: { [x: string]: (message: Message, params: string[], level: number) => any } = {

    'list': async (message: Message, params: string[], level: number) => {
      if (params.length === 0 || isNaN(parseInt(params[0])))
        return await message.channel.send({ embed: Embeds.playlistCategoriesEmbed(message.guild.name, config.commandToken) });
      const idx = parseInt(params[0]);
      if (idx === 1) {
        const botUser = await users.getUser(bot.client.user.id);
        if (botUser.playlists.num === 0) return await message.channel.send(`**I am still working on those! ;)**`);
        return await message.channel.send({ embed: Embeds.userPlaylistsEmbed(bot.client.user, botUser.playlists, false) });
      } else if (idx === 2) {
        const members = message.guild.members.array().map( member => member.id );
        const playlistUsers = await users.getList(members);
        const playlists = playlistUsers.reduce((a, b) => {
          a.num += b.playlists.num;
          _.forEach(b.playlists.list, (playlist, key) => {
            a.list[key] = playlist;
            a.list[key].owner = message.guild.members.get(b.userId).displayName;
          })
          return a;
        }, { num: 0, list: {} });
        if (playlists.num === 0) return await message.channel.send('**No one on this server has playlists yet!**');
        return await message.channel.send({ embed: Embeds.guildPlaylistsEmbed(message.guild, playlists) });
      } else if (idx === 3) {
        const guildUser = await users.getUser(message.author.id);
        if (guildUser.playlists.num === 0)
          return await message.reply(`You don't have any playlists yet! Check out \`${config.commandToken}help pl.new\` to get started!`);
        return await message.channel.send({ embed: Embeds.userPlaylistsEmbed(message.author, guildUser.playlists, true) });
      }
      await message.reply('Nothing corresponds to that index!');
    },
    
    'new': async (message: Message, params: string[], level: number) => {
      const paramsReg = /^\s*([^\s]+)\s+"([^"]+)"\s*$/g
      const match = paramsReg.exec(params.join(' '));
      if (_.isNil(match))
        return await message.reply(`Incorrect usage! The format is: \`${config.commandToken}pl.new <playlistId> "<name>"\``);

      const plId = match[1];
      if (plId.length > 7) return await message.reply(`Playlist ID exceeds maximum character length of \`7\`!`)
      const name = match[2].trim().replace(/\s+/g, ' ');
      if (name.length > 25) return await message.reply(`Name exceeds maximum character length of \`25\`!`);
      const err = await users.newPlaylist(message.author.id, plId, name);
      await message.reply(err ? err : `The playlist **${name}** has been created and can be identified using \`${plId}\``);
    },

    'add': async (message: Message, params: string[], level: number) => {
      const paramsReg = /^\s*([^\s]+)\s+-\s+(.+)\s*/g
      const match = paramsReg.exec(params.join(' '));
      if (_.isNil(match))
        return await message.reply(`Incorrect usage! The format is: \`${config.commandToken}pl.add <playlistId> - (<query> | <specific>)\``);
      
      const plId = match[1];
      const paramsText = match[2];
      const queryResult = await Utils.songQuery(message, paramsText, scUsers, users, scApi, ytApi);
      if (_.isNil(queryResult)) return;

      const err = await users.addToPlaylist(message.author.id, plId, queryResult.songs);
      if (err) return await message.reply(err);

      const nameOrLength = queryResult.songs.length > 1 ? `${queryResult.songs.length} songs` : `**${queryResult.songs[0].title}**`;
      let addedMsg = `Successfully added ${nameOrLength} to the playlist!`;
      await message.reply(addedMsg);
    },

    'remove': async (message: Message, params: string[], level: number) => {
      const paramsReg = /^\s*([^\s]+)\s+\[\s*(-?\d+(\s*,\s*-?\d+)?|ALL)\s*]\s*$/gi;
      const match = paramsReg.exec(params.join(' '));
      if (_.isNil(match))
        return await message.reply(`Incorrect usage! The format is \`${config.commandToken}pl.remove <playlistId> <range>\``);
      
      const plId = match[1];
      const range = match[2];
      let err: string;
      if (range.toLowerCase() === "all") {
        err = await users.removeFromPlaylist(message.author.id, plId, 0, 0);
      } else {
        const numberRange = range.split(',').map(x => parseInt(x));
        if (numberRange[0] === 0) return await message.reply(`First number in the range can not be zero!`);
        err = numberRange.length === 2 ? await users.removeFromPlaylist(message.author.id, plId, --numberRange[0], numberRange[1]) :
          await users.removeFromPlaylist(message.author.id, plId, --numberRange[0]);
      }

      await message.reply(err ? err : "I have removed those songs from the playlist!");
    },

    'delete': async (message: Message, params: string[], level: number) => {
      if (params.length === 0) return await message.reply('Missing parameters: <playlistId>');
      const err = await users.deletePlaylist(message.author.id, params[0]);
      await message.reply(err ? err : `Your playlist identified by \`${params[0]}\` has been successfully removed.`);
    },

    'info': async (message: Message, params: string[], level: number) => {
      if (params.length === 0) return message.reply('Missing parameter: <playlistId>');
      const user = await users.getUserFromPlaylistId(params[0]);
      if (_.isNil(user)) return await message.reply('That playlist does not exist!');

      const playlist = user.playlists.list[params[0]];
      let playlistInfo = config.playlistInfo;
      playlistInfo = playlistInfo.replace(/%TITLE%/g, playlist.name);
      playlistInfo = playlistInfo.replace(/%DETAIL%/g, `Owner: ${bot.client.users.get(user.userId).username} ~ Songs: ${playlist.size} ~ ID: ${params[0]}`);
      playlistInfo = playlistInfo.replace(/'%SONGS%'/g, JSON.stringify(playlist.list));

      const readable = new Readable();
      readable._read = () => {};
      readable.push(playlistInfo);
      readable.push(null);

      const attachment = new Attachment(readable, `${playlist.name}.html`);
      await message.channel.send('Here ya go!', attachment);
    }
  }

  bot.on(config.commands.find(cat => cat.name === 'Playlist').prefix, (command: string, message: Message, params: string[], level: number) => {
    commands[command](message, params, level);
  });
}