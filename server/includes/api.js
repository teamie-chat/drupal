module.exports.getApiServer = function (conf, redisClient, core) {
  var express = require('express'),
    app = express();

  app.use(express.bodyParser());

  app.get('/', function (req, res) {
    res.send(401);
  });

  app.post('/ping', function (req, res) {
    var sentToken;
    if (!(sentToken = req.body.token)) {
      res.send(400);
    }
    if (sentToken !== conf.apiToken) {
      res.send(401);
    }
    res.send('pong');
  });

  app.get('/api/user/:uid/threads', function (req, res) {
    var token = req.query.token,
      uid = req.params.uid;
    if (!token || !uid) {
      res.send(400);
    }
    if (token === conf.apiToken) {
      if (isFinite(uid) && !isNaN(uid)) {
        uid = parseInt(uid);
        core.getRecentThreads(uid, new Date().getTime() + 480, function (threads) {
          res.send(JSON.stringify(threads));
        })
      }
      else {
        res.send(400);
      }
    }
    else {
      res.send(401);
    }
  });

  app.get('/api/thread/:threadId/messages', function (req, res) {
    var token = req.query.token,
      offset = req.query.offset || 10,
      threadId = req.params.threadId;
    if (!token || !threadId) {
      res.send(400);
    }
    if (token == conf.apiToken) {
      var start = offset;
      var end = offset + conf.maxChatMessagesPerRequest;
      redisClient.lrange(threadId, start, end, function (err, messages) {
        res.send(JSON.stringify(messages));
      })
    }
    else {
      res.send(401);
    }
  });

  return app;
};