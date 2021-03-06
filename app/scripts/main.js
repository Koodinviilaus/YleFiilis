'use strict';

import config from '../../config.json';
import CryptoJS from 'crypto-js';
import fetchp from 'fetch-jsonp';
import Player from './views/Player';
import Toolbar from './views/Toolbar';
import ChatBox from './views/ChatBox';

/**
 * Fetch the current TV shows using JSONP and fetch JSONP polyfill.
 *
 * @param {Array<String>} [services=[]] - a string array of YLE service IDs o use as filter
 * @return {Array<Object>} YLE program metadata in unparsed form
 */
async function fetchCurrentPrograms(services = []) {
  const url = new URL(`${baseUrl}/programs/schedules/now.json`);
  const params = url.searchParams;
  params.set('app_id', config.appId);
  params.set('app_key', config.appKey);
  params.set('service', services.join(','));
  params.set('start', '0');
  params.set('end', '0');

  // Fix the jsonp callback function name for service worker compatibility
  const options = {jsonpCallbackFunction: 'jsonp_options'};

  const response = await fetchp(url.href, options);
  // TODO Validate response
  const json = await response.json();
  return json.data;
}

/**
 * Fetch the YLE services using JSONP and fetch JSONP polyfill.
 *
 * @param {String} [type='TVChannel'] - the type of services to fetch
 * @return {Array<Object>} YLE service metadata in unparsed form
 */
async function fetchServices(type = 'TVChannel') {
  const url = new URL(`${baseUrl}/programs/services.json`);
  const params = url.searchParams;
  params.set('app_id', config.appId);
  params.set('app_key', config.appKey);
  params.set('type', type);

  // Fix the jsonp callback function name for service worker compatibility
  const options = {jsonpCallbackFunction: 'jsonp_services'};

  let response;
  try {
    response = await fetchp(url.href, options);
    const json = await response.json();
    return json.data;
  } catch (error) {
    console.warn('hoi', error);
  }
}

/**
 * Fetch the stream URL and metadata using JSONP and fetch JSONP polyfill.
 *
 * @param {String} programId - the id of the program
 * @param {String} mediaId - the id of the media
 * @return {Object} The streaming metadata, including URL etc.
 */
async function fetchStream(programId, mediaId) {
  const url = new URL(`${baseUrl}/media/playouts.json`);
  const params = url.searchParams;
  params.set('app_id', config.appId);
  params.set('app_key', config.appKey);
  params.set('program_id', programId);
  params.set('media_id', mediaId);
  params.set('protocol', 'HLS');

  // Fix the jsonp callback function name for service worker compatibility
  const options = {jsonpCallbackFunction: 'jsonp_stream'};

  const response = await fetchp(url.href, options);
  // TODO Validate response
  const json = await response.json();
  return json.data[0];
}

/**
 * Fetches the YLE programs and services and maps them into easier to digest array.
 * The values get populated into 'services' and 'programs' globals.
 */
async function fetch() {
  // Fetch the current program of all the services
  const services = await fetchServices();
  const newPrograms = await fetchCurrentPrograms(services.map((s) => s.id));

  channels = services.map((service) => {
      return {
        id: service.id,
        title: service.title.fi || service.title.sv,
      };
    })
    // Only use channels that have a current program available
    .filter((c) => newPrograms.find((p) => c.id === p.service.id));

  programs = newPrograms.map((program) => {
    const linkedChannel = channels.find((c) => c.id === program.service.id);
    const imageId = (program.content.image && program.content.image.id) ?
      program.content.image.id :
      program.content.partOfSeries && program.content.partOfSeries.coverImage ?
        program.content.partOfSeries.coverImage.id : '';
    const mediaId = program.content.publicationEvent
      .map((e) => {
        if (e.temporalStatus !== 'currently' || e.type !== 'OnDemandPublication') {
          return null;
        }

        if (!e.media || !e.media.available) {
          return null;
        }

        return e.media.id;
      })
      .find((id) => id !== null);

    return {
      id: program.id,
      contentId: program.content.id,
      channelId: linkedChannel.id,
      imageId: imageId,
      mediaId: mediaId,
      title: program.content.title.fi || program.content.title.sv,
      channel: linkedChannel.title,
      description: program.content.description.fi || program.content.description.sv,
      startTime: new Date(program.startTime),
      endTime: new Date(program.endTime),
      playbackUrl: mediaId ? `#play/${program.content.id}/${mediaId}` : null,
    };
  });
}

/**
 * Decryption function adopted from YLE API http://developer.yle.fi/static/decrypt-url.js
 *
 * @param {String} url - The encoded URL to decrypt
 * @param {String} secret - The decoding secret
 * @return {String} The decrypted URL
 */
function decrypt(url, secret) {
  const data = CryptoJS.enc.Base64.parse(url).toString(CryptoJS.enc.Hex);
  const key = CryptoJS.enc.Utf8.parse(secret);
  const iv = CryptoJS.enc.Hex.parse(data.substr(0, 32));
  const message = CryptoJS.enc.Hex.parse(data.substr(32));

  const options = {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  };

  const params = CryptoJS.lib.CipherParams.create({ciphertext: message});
  const decryptedMessage = CryptoJS.AES.decrypt(params, key, options);
  return decryptedMessage.toString(CryptoJS.enc.Utf8);
}

/**
 * Initialises this application asynchronously.
 */
async function init() {
  console.log('Initialise the application');

  // Register the service worker
  // [::1] is the IPv6 localhost address; 127.0.0.1/8 is localhos
  // const isLocalhost = Boolean(window.location.hostname === 'localhost' ||
  //       window.location.hostname === '[::1]' || window.location.hostname.match(
  //       /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
  //     )
  //   );

  // if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || isLocalhost)) {
  //   // Wait for Service Worker to register, then assign the handle
  //   const swRegistration = await navigator.serviceWorker.register('service-worker.js');

  // }

  // Fetch the data
  await fetch();

  // Default to the first channel
  location.hash = `#channels/${channels[0].id}`;

  // Manually trigger route change.
  handleRouteChange();
}

/**
 * Handles the URL (hash part) route change and update the application accordingly.
 *
 * @return {undefined} - No actual return value
 */
async function handleRouteChange() {
  // Fetch the current route
  const hashPart = location.hash.replace(/^#/, '');
  console.log(`Handle route change '${hashPart}'`);

  // Perform the routing
  const segments = hashPart.split('/');

  // Infer the current channel from the URL hash part
  const channelId = segments[1];
  // Just use the programs that are specific for this channel
  const filtered = programs.filter((p) => p.channelId === channelId );
  const currentProgram = filtered[0];

  // Update toolbar and render it
  toolbar.program = currentProgram;
  toolbar.channels = channels;
  toolbar.render();

  const contentId = currentProgram.contentId; //segments[1];
  const mediaId = currentProgram.mediaId; //segments[2];

  const stream = await fetchStream(contentId, mediaId);
  const url = decrypt(stream.url, config.secret);

  player.url = url;
  player.program = currentProgram;
  player.render();

  chatbox.render()
}


// UI elements we bind to
const header = document.querySelector('header');
const main = document.querySelector('main');
const section = document.querySelector('#chatbox');

// API configuration
const baseUrl = 'https://external.api.yle.fi/v1';

// Application state data
let channels = [];
let programs = [];

// UI Elements
const toolbar = new Toolbar(header);
const player = new Player(main);
const chatbox = new ChatBox(section)

// Update for UI state changes
window.addEventListener('hashchange', handleRouteChange);

// Bootstrap the app
init();
