module.exports.getSocketServer = function(conf, core, server) {
	var socketio = require('socket.io'),
		sio = socketio.listen(server, {
			log: false
		});

	sio.configure(function() {
		sio.set('authorization', function(handshakeData, callback) {
			if (!handshakeData.headers.cookie) {
				callback('Cookie is not sent', false);
			}
			else {
				core.getUserId(handshakeData.headers.cookie, function (userId) {
					if (userId === -1) {
						callback('Invalid sid token', false);
					}
					else {
						callback(null, true);
					}
				});
			}
		});
	});

	sio.on('connection', function(client) {
		core.onSocketConnect.apply(core, [client, sio]);
	});
};