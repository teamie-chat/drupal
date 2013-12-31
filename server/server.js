var SERVER_PORT = 8888;
var CONF_FILE = './conf.js';

var stdio = require('stdio'), 
 _ = require('underscore'),
 fs = require('fs');

var opts = stdio.getopt({
	'port': { key: 'port', args: 1, description: "The port on which you'd want the server to run from." },
	'conf': { key: 'conf', args: 1, description: 'Path to the configuration file. Defaults to ' + CONF_FILE + '.' }
});

var confFile = opts.conf ? opts.conf : CONF_FILE;
if (!fs.existsSync(confFile)) {
	throw new Error('The configuration file could not be found at ' + confFile);
}
var conf = require(confFile).get();
var port = opts.port ? opts.port : SERVER_PORT;
if (!_.isFinite(port)) {
	throw new Error('Server port must be an integer.');
}

var http = require('http'),
_s = require('underscore.string'),
redis = require('redis'),
cookie = require('cookie'),
mysql = require('mysql');

var redisClient = redis.createClient(conf.redis.port,conf.redis.host,{ no_ready_check: true });
if (conf.redis.password) {
	redisClient.auth(conf.redis.password);
}

var mysqlConn = mysql.createConnection(conf.mysql);
mysqlConn.connect();

var core = require('./includes/core.js').getCore(conf, redisClient, _, _s, cookie, mysqlConn);
var app = require('./includes/api.js').getApiServer(conf, redisClient, core);
server = http.createServer(app).listen(port);
console.log('Listening at http://localhost:' + port);
require('./includes/socket.js').getSocketServer(conf, core, server);