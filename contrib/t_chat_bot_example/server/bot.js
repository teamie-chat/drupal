/*
 *  Little example of how to use ```socket-io.client``` and ```request``` from node.js
 *  to authenticate thru http, and send the cookies during the socket.io handshake.
 */
 
 // https://npmjs.org/package/socket.io-client
 // https://gist.github.com/jfromaniello/4087861
 // https://npmjs.org/package/request
 // https://npmjs.org/package/tough-cookie (used by request above)
 // http://publicsuffix.org/learn/ (why *.dev domains are rejected.)
 // https://npmjs.org/api/npm.html
 // http://nodejs.org/api/timers.html

var io = require('socket.io-client');
var request = require('request');
var npm = require('npm');
var fs = require('fs');

try {
var configJson = fs.readFileSync('./config.json');
} catch (e) {
  console.error('Missing config.json file. A config.json file must be placed in the same ' + 
  'directory that this script is being run from. You can copy config.json.example and modify the same.');
  return;
}

var config = JSON.parse(configJson);

npm.load(function() {  
  /*
   * This is the jar (like a cookie container) we will use always
   */
  var j = request.jar();

  /*
   *  First I will patch the xmlhttprequest library that socket.io-client uses
   *  internally to simulate XMLHttpRequest in the browser world.
   */
  var originalRequest = require('xmlhttprequest').XMLHttpRequest;

  require(npm.prefix + '/node_modules/socket.io-client/node_modules/xmlhttprequest').XMLHttpRequest = function() {
    originalRequest.apply(this, arguments);
    this.setDisableHeaderCheck(true);
    var stdOpen = this.open;

    /*
     * I will patch now open in order to set my cookie from the jar request.
     */
    this.open = function() {
      var that = this;
      stdOpen.apply(this, arguments);
      var header = j.getCookies(config.DRUPAL_SITE_URL, function(err, cookies) {
        that.setRequestHeader('cookie', cookies.join(';'));
      });
    };
  };

  /*
   * Authenticate first, doing a post to some url 
   * with the credentials for instance
   */
  request.post({
    jar: j,
    url: config.DRUPAL_SITE_URL + config.DRUPAL_SERVICES_BASE_PATH + '/user/login',
    form: config.BOT
  }, function (err, resp, body) {
    var socket = io.connect(config.CHAT_SERVER_URL);
    socket.on('connect', function() {
      console.log('Connected successfully!')
    });
    // Keep track of who you are replying too.
    var replyProcess = [];
    socket.on('message', function(message) {
      var message = JSON.parse(message);
      // Only supports 1-1 conversations for now.
      if (message.responseType === 1) {
        var max = 4;
        var i = 1;
        var proverbs = [
          'A stich in time saves nine',
          'Look before you leap',
          'A bird in the hand is worth two in the bush',
          'Never be like the dog in the manger'
        ];
        // If I was already replying to the person in question, stop doing so.
        if (replyProcess[message.senderId]) {
          clearInterval(replyProcess[message.senderId]);
        }
        var intervalId = setInterval(function() {
          socket.send(JSON.stringify({
            requestType: 1,
            receiverId: message.senderId,
            content: proverbs[i - 1], 
            time: new Date().getTime()
          }));
          if (i === max) {
            clearInterval(intervalId);
            delete replyProcess[message.senderId];
            return;
          }
          i++;
        }, 1000);
        // Indicate that we have started replying.
        replyProcess[message.senderId] = intervalId;
      }
    });
  });  
});