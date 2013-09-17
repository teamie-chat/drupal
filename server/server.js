// @TODO De-couple MYSQL, Redis config to different files so that they may be specified as command-line options as well.
// @TODO Move image style, default profile image logic to the client as it's dependent less on the server and more on the connecting Drupal site.
// @TODO Upload emoticons.
// @TODO Move HTTP request handlers and API (DB and otherwise) methods to different files (api.js/http.js) so that they can be maintained easily and independently.

var SERVER_DEFAULT_PORT = 8888;
var MYSQL_CONFIGS = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'drupal',
  prefix: ''
};
var IMAGE_URL_PREFIX = "http://example.com/sites/default/files/styles/chat_profile/";
var DEFAULT_PROFILE_IMAGE_URL = "http://example.com/sites/default/files/user-default-pic.png";
var REDIS_CONFIGS = {
    host: 'localhost',
    port: 6379,
    password: 'test',
    prefix: '' 
}
var API_TOKEN = "myVerySecretToken";

var ONE_ONE_THREAD_FORMAT = REDIS_CONFIGS.prefix + "1.1.thread:%d:%d";
var GROUP_THREAD_FORMAT = REDIS_CONFIGS.prefix + "group.thread:%d";
var MULTIUSER_THREAD_MSG_FORMAT = REDIS_CONFIGS.prefix + "multiuser.thread:%d";
var MULTIUSER_THREAD_USER_FORMAT = REDIS_CONFIGS.prefix + "multiuser.thread:%d:users";
var USER_UNREAD_THREADS_FORMAT = REDIS_CONFIGS.prefix + "user:%d:unread.threads";
var USER_THREADS_FORMAT = REDIS_CONFIGS.prefix + "user:%d:threads"; //all user threads in time order
var USER_ACTIVE_THREADS = REDIS_CONFIGS.prefix + "user:%d:active.threads";
var MULTIUSER_THREAD_ID_GENERATOR = REDIS_CONFIGS.prefix + "multiuser.thread:id";
var USER_ACTIVE_THREADS_KEY = REDIS_CONFIGS.prefix + "user:%d:active.thread";
var SOCKET_USER_ROOM_FORMAT = REDIS_CONFIGS.prefix + "user:%d";
var USER_OFFLINE_STATUS = REDIS_CONFIGS.prefix + "user:%d:offline.status";

var THREAD_TYPE = {
  oneOneThread: 1,
  multiuserThread: 2,
  groupThread: 3
};
var MAX_RECENT_THREADS_PER_REQUEST = 10;
var MAX_WEB_SERVICE_MESSAGES_PER_REQUEST = 100;
var USER_STATUS ={offline:0, online:1};
var NUM_OLD_MESSAGES_PER_REQUEST = 50;
var REQUEST_TYPE = {
  sendOOThreadMessage: 1,
  sendGroupThreadMessage: 2,
  sendMultiUserThreadMessage: 3,
  initiateMultiUserThread: 4,
  addFriendToMultiUserThread: 5,
  leaveMultiUserThread: 6,
  getInitData: 10,
  getOldMessages: 11,
  getMultiuserThreadDetails: 12,
  getUsersDetails: 13,
  markThreadAsRead:14,
  getRecentThreads: 15,
  updateOfflineStatus: 16
};
var RESPONSE_TYPE = {
  initData: 0,
  newMessage: 1,
  oldMessages: 2,
  initMultiuserThread: 3,
  updateMultiuserThreadInfo: 4,
  leaveMultiuserThread: 5,
  getMultiuserThreadDetails: 6,
  usersDetails: 7,
  updateUserStatus: 8,
  markThreadAsRead:9,
  getRecentThreads: 10,
  updateOfflineStatus: 11
};

var fs = require('fs'),
express = require('express'),
app = express(),
http = require('http'),
_ = require('underscore'),
_s = require('underscore.string'),
socketio = require('socket.io'),
redis = require('redis'),
cookie = require('cookie'),
mysql = require('mysql'),
stdio = require('stdio');

var opts = stdio.getopt({
	'port': {
		key: 'port',
		args: 1,
		description: 'The port in which you want to server to run from'
	}
});

var port = opts.port ? opts.port : SERVER_DEFAULT_PORT;
if (!_.isFinite(port)) {
	throw new Error('Server port must be an integer.');
}

app.use(express.bodyParser());

// Connect to Redis.
var redisClient = redis.createClient(REDIS_CONFIGS.port,REDIS_CONFIGS.host,{no_ready_check: true});
redisClient.on("error", function(err) {
  console.log("Redis Error " + err);
});
redisClient.auth(REDIS_CONFIGS.password, function() {
    console.log('Redis client connected');
});

// Connect to MySQL.
mysqlConn = mysql.createConnection(MYSQL_CONFIGS);
mysqlConn.connect();

// Start the HTTP server.
server = http.createServer(app).listen(port);
console.log('Listening at http://localhost:' + port);

process.on('uncaughtException', function(err) {
  console.trace(err);
});

var hasKeys = function(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (! (keys[i] in obj)) return false;
  }
  return true;
};
/*to return userid or -1 given a cookie string*/
var getUserId = function(cookieString, callback) {
  console.log(cookieString);
  var sidToken = null,
  senderId;
  if (cookieString) {
    parsedCookie = cookie.parse(cookieString);
    _.each(parsedCookie, function(val, key) {
      if (_s.startsWith(key, "SESS")) {
        sidToken = val;
      }
    });
    if (sidToken === null) {
      callback( - 1);
    } else {
      mysqlConn.query(_s.sprintf('SELECT uid FROM %ssessions WHERE sid = ?',MYSQL_CONFIGS.prefix), [sidToken], function(err, results) {
        if (err) console.log("MySQL error" + err);
        else {
          callback(results.length !== 1 ? - 1: results[0].uid);
        }
      });
    }
  } else {
    callback( - 1);
  }
};

//to check if a user belongs to a thread
var isUserInThread = function(userId, threadId,callback){
  var re = _s.sprintf("^(1.1.thread:[0-9]{1,}:%d|1.1.thread:%d:[0-9]{1,})$",userId,userId);
  re = new RegExp(re);
  if (re.exec(threadId)){
    callback(true);
  };

  if (threadId.match("^group\.thread:[0-9]{1,}")){
    var groupId = threadId.match(":[0-9]{1,}")[0].replace(":", "");
    groupId = parseInt(groupId);
    getGroupMembers(groupId,function(groupMemberIds){
      for (var i = 0, l = groupMemberIds.length; i < l; i++) {
        if (groupMemberIds[i].uid == userId) {
          callback(true);
        }
      }

      callback(false);
    });

  }else if (threadId.match("^multiuser\.thread:[0-9]{1,}")){
    var threadIdNum = threadId.match(":[0-9]{1,}")[0].replace(":", "");
    threadIdNum = parseInt(threadIdNum);
    var threadRedisKey = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT, threadIdNum);
    redisClient.sismember(threadRedisKey, userId, function(err, replies) {
      if(err) console.trace(err);
      callback(replies);
    });
  }
}
//to remove threads from user's records
var removeThreads = function(userId,threadIds, callback) {
  if(typeof threadIds === "number") threadIds = [threadIds];
  if(threadIds.length>0){

    var threadRedisKey = _s.sprintf(USER_THREADS_FORMAT, userId);
    var threadRedisKey2 = _s.sprintf(USER_UNREAD_THREADS_FORMAT , userId);

    var redisTrans = redisClient.multi() 
    .zrem(threadRedisKey,threadIds)
    .hdel(threadRedisKey2,threadIds)
    .exec(function(err, numThreadRemoved) {
      if (err) console.log(err);
      callback(numThreadRemoved);
    })
  }else{
    callback(0);
  }
}
//to check if 2 or more users are connected to sender
var hasConnection = function(senderId, receiverIds, callback) {
  if(typeof receiverIds === "number"){
    receiverIds = [receiverIds];
  }
  if (receiverIds.length>0){
    var sqlQueryFormat = _s.sprintf("SELECT count(distinct users.uid) as count FROM %susers users INNER JOIN %sog_membership og_membership_users ON users.uid = og_membership_users.etid AND og_membership_users.entity_type = 'user' AND og_membership_users.state = 1 WHERE (((users.status <> '0')) AND (((og_membership_users.gid IN (SELECT gid FROM %sog_membership om WHERE entity_type = 'user' AND etid = ? AND state = 1)) AND ((users.uid in (?))))))",MYSQL_CONFIGS.prefix, MYSQL_CONFIGS.prefix, MYSQL_CONFIGS.prefix);
    mysqlConn.query(sqlQueryFormat, [senderId, receiverIds], function(err, results) {
      if (err) console.log("MySQL error" + err);
      else {
        callback(results[0].count === receiverIds.length);
      }
    });
  }
};

//to call back with an object containing unread threads and number of threads each
var getUnreadThreads = function(userId,callback) {
  var redisKey = _s.sprintf(USER_UNREAD_THREADS_FORMAT, userId);
  redisClient.hgetall(redisKey,function(err,results){
    if(err) console.trace(err);
    _.each(results,function(val,key,arr){
      arr[key]=parseInt(val);
    })

    callback(results||{});
  })
};
//to callback with an array of recent threads object, each with its threadId and time
//sorted in most recent order, only return MAX_RECENT_THREADS_PER_REQUEST threads
//all threads are older than [time]
var getRecentThreads = function(userId, time, callback) {

  var redisKey = _s.sprintf(USER_THREADS_FORMAT, userId);
  //almost impossible bug: num of threads with same timestamp > MAX_RECENT_THREADS_PER_REQUEST
  //can use offset to solve this
  redisClient.zrevrangebyscore([redisKey,time,0,'LIMIT',0,MAX_RECENT_THREADS_PER_REQUEST], function(err, threadIds) {
    if(err) console.trace(err);
    var threads = [];
    var count = threadIds.length;
    if(threadIds.length>0){
      _.each(threadIds,function(threadId,index){
        redisClient.lrange(threadId,0,0, function(err, message) {
          if(err) console.trace(err);
          threads[index]={threadId: threadId,messages: [JSON.parse(message)]};
          count--;
          if (count === 0){
            callback(threads);
          }
        });
      });
    }else{
      callback(threads);
    }
  });
};

var getUserGroups = function(userId, callback) {
  var sqlQueryFormat = _s.sprintf("SELECT DISTINCT node.nid AS groupId, node.title as name FROM %snode node INNER JOIN %sog og_node ON node.nid = og_node.etid AND og_node.entity_type = 'node' INNER JOIN %sog_membership og_membership_og ON og_node.gid = og_membership_og.gid WHERE (( (node.status = '1') AND (og_membership_og.etid = '?') )AND(( (og_membership_og.entity_type IN  ('user')) AND (og_membership_og.state IN  ('1')) ))) ",MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix);

  mysqlConn.query(sqlQueryFormat, [userId], function(err, results) {
    if (err) console.log("MySQL error" + err);
    else {
      callback(results);
    }
  });
};
var getUsersDetails = function(userIds, callback) {
  var sqlQueryFormat = _s.sprintf("SELECT DISTINCT users.uid as userId, if(realname.realname LIKE '', users.name, realname.realname) as name, file_managed.uri as image FROM %susers users INNER JOIN %sog_membership og_membership_users ON users.uid = og_membership_users.etid AND og_membership_users.entity_type = 'user' LEFT JOIN %srealname realname ON users.uid = realname.uid LEFT JOIN %sfile_managed file_managed ON users.picture = file_managed.fid WHERE ((users.status <> '0') AND (etid in (?)))",MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix);

  mysqlConn.query(sqlQueryFormat, [userIds], function(err, results) {
    if (err) console.log("MySQL error" + err);
    else {
      _.each(results,function(u){
        u.image= u.image && u.image.replace("://","/");
      });
      callback(results);
    }
  });
};
var getUserRoster = function(userId, callback) {
  var sqlQueryFormat = _s.sprintf("SELECT DISTINCT users.uid as userId, if(realname.realname LIKE \"\",users.name,realname.realname) as name,file_managed.uri as image FROM %susers users INNER JOIN %sog_membership og_membership_users ON users.uid = og_membership_users.etid AND og_membership_users.entity_type = 'user' LEFT JOIN %srealname realname ON users.uid = realname.uid LEFT JOIN %sfile_managed file_managed ON users.picture = file_managed.fid WHERE (((users.status <> '0')) AND (((og_membership_users.gid IN (SELECT gid from %sog_membership where etid = ?))))) ",MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix);

  mysqlConn.query(sqlQueryFormat, [userId], function(err, results) {
    if (err) console.log("MySQL error" + err);
    else {

      _.each(results,function(u){
        u.image= u.image && u.image.replace("://","/");
      });
      callback(results);
    }
  });
};
var getGroupMembers = function(groupId, callback) {
  groupId = parseInt(groupId,10);
  var sqlQueryFormat = _s.sprintf("SELECT DISTINCT users.uid AS uid FROM %susers users INNER JOIN %sog_membership og_membership_users ON users.uid = og_membership_users.etid AND og_membership_users.entity_type = 'user' INNER JOIN %sog og_og_membership ON og_membership_users.gid = og_og_membership.gid WHERE (( (og_og_membership.entity_type = 'node') AND (og_og_membership.etid = '?' ) )) ",MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix,MYSQL_CONFIGS.prefix);

  mysqlConn.query(sqlQueryFormat, [groupId], function(err, results) {
    if (err) {
      console.log("MySQL error" + err);
    } else {
      callback(results);
    }
  });
};
sio = socketio.listen(server);
sio.configure(function() {
  sio.set('authorization', function(handshakeData, callback) {
    if (!handshakeData.headers.cookie) {
      callback("Cookie is not sent", false);
    } else {
      getUserId(handshakeData.headers.cookie, function(userId) {
        if (userId === - 1) {
          callback("Invalid sid token", false);
        } else {
          callback(null, true);
        }
      });
    }
  });
});
//to notify users' friend that he goes online/offline
function notifyUserStatus(userId,connCount,appearOffline){
  var status;
  if(connCount===0){
    status = USER_STATUS.offline;
  }else if(connCount===1){
    if(appearOffline){
      status = USER_STATUS.offline;
    }else{
      status = USER_STATUS.online;
    }
  }
  if ((connCount <=1) || (typeof appearOffline !=="undefined")){
    //user goes offline/online, notify his/her friends
    var response = {
      responseType: RESPONSE_TYPE.updateUserStatus,
      status: status,
      userId: userId
    };
    getUserRoster(userId, function(results) {
      _.each(results,function(friend){
        if(friend.userId!=userId){
          sio.sockets.in(_s.sprintf(SOCKET_USER_ROOM_FORMAT, parseInt(friend.userId))).emit('message', JSON.stringify(response));
        }
      })
    })
  }
}

sio.on('connection', function(client) {
  if (!client.handshake.headers.cookie) {
    callback("Cookie is not sent", false);
    client.disconnect("Cookie is not sent")
  } else {
    getUserId(client.handshake.headers.cookie, function(userId) {
      if (userId === - 1) {
        client.disconnect("Invalid sid token");
      } else {
        var roomName = _s.sprintf(SOCKET_USER_ROOM_FORMAT, userId);
        client.join(roomName);
        notifyUserStatus(userId,sio.sockets.clients(roomName).length);
      }
    });
  }

  var getThreadTypeFromId = function(threadId) {
    if (threadId.match("^1\.1\.thread:[0-9]{1,}:[0-9]{1,}")) return THREAD_TYPE.oneOneThread;
    else if (threadId.match("^group\.thread:[0-9]{1,}")) return THREAD_TYPE.groupThread;
    else if (threadId.match("^multiuser\.thread:[0-9]{1,}")) return THREAD_TYPE.multiuserThread;
    else return - 1;
  };

  var getThreadReceiver = function(threadId,senderId) {
    switch (getThreadTypeFromId(threadId)) {
      case THREAD_TYPE.oneOneThread:
        var user1Id = threadId.match(":[0-9]{1,}")[0];
      var user2Id = parseInt(threadId.replace(user1Id, "").match(":[0-9]{1,}")[0].replace(":", ""));
      user1Id = parseInt(user1Id.replace(":", ""));
      if (user1Id == senderId) return user2Id;
      else return user1Id;
      break;
      case THREAD_TYPE.groupThread:
        var groupId = threadId.match(":[0-9]{1,}")[0].replace(":", "");
      return parseInt(groupId);
      break;

      case THREAD_TYPE.multiuserThread:
        var threadNumId = threadId.match(":[0-9]{1,}")[0].replace(":", "");
      return parseInt(threadNumId);
      break;

      default:
        console.trace("Error: unknown thread");
    }
    return null;
  }

  client.on('message', function(msg) {
    getUserId(client.handshake.headers['cookie'], function(senderId) {
      if (senderId === - 1) {
        client.disconnect("Session is invalid or expired. Please login again.")
      } else {
        try {
          msg = JSON.parse(msg);
          if (_.has(msg, "requestType")) {
            switch (msg.requestType) {
              case REQUEST_TYPE.initiateMultiUserThread:
                if (hasKeys(msg, ["users"])) {
                hasConnection(senderId, msg.users,function(has_connection){
                  if(has_connection){
                    redisClient.incr(MULTIUSER_THREAD_ID_GENERATOR, function(err, newThreadIdNum) {
                      if (err) console.trace(err);
                      var redisKey = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT, parseInt(newThreadIdNum));
                      var newThreadUsers = msg.users;
                      if (newThreadUsers.indexOf(senderId) === - 1) newThreadUsers.push(senderId);

                      if (newThreadUsers.length>=3){
                        var count = newThreadUsers.length; //always > 0, thus each loop always happen.
                        _.each(newThreadUsers, function(userId) {
                          redisClient.sadd(redisKey, userId, function(err) {
                            if (err) console.trace(err);
                            count--;
                            if (count === 0) {
                              //done adding all users to db
                              var response = {
                                responseType: RESPONSE_TYPE.initMultiuserThread
                              };
                              response.threadId = _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT, parseInt(newThreadIdNum));
                              response.users = newThreadUsers;
                              response.initiator = senderId;
                              if (msg.originalThread) response.originalThread = msg.originalThread;
                              _.each(newThreadUsers, function(userId) {
                                sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, parseInt(userId))).emit('message', JSON.stringify(response));
                              });
                            }
                          })
                        })
                      }
                    })
                  }
                }) 
              } else {
              }
              break;
              case REQUEST_TYPE.getUsersDetails:
                if (hasKeys(msg, ["userIds"])) {
                if (typeof msg.userIds === "number") msg.userIds = [msg.userIds];
                if (msg.userIds.length>0) {
                  getUsersDetails(msg.userIds, function(results) {
                    var responseMsg = {
                      responseType: RESPONSE_TYPE.usersDetails,
                      users: results
                    };
                    client.send(JSON.stringify(responseMsg));
                  })
                }
              }
              break;
              case REQUEST_TYPE.getMultiuserThreadDetails:
                if (hasKeys(msg, ["threadIdNum"])) {

                var threadId = _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT, parseInt(msg.threadIdNum));
                var responseMsg = {
                  responseType: RESPONSE_TYPE.getMultiuserThreadDetails,
                  id: threadId
                };
                responseMsg.type = "multiuserThread";
                var threadUsers = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT,parseInt(msg.threadIdNum));
                redisClient.smembers(threadUsers, function(err, members) {
                  if (err) console.log(err);
                  _.each(members, function(val, i, arr) {
                    arr[i] = parseInt(val);
                  })
                  responseMsg.users = members;
                  client.send(JSON.stringify(responseMsg));
                })
              }
              break;
              case REQUEST_TYPE.updateOfflineStatus:
                if("isChatOffline" in msg){
                var redisKey = _s.sprintf(USER_OFFLINE_STATUS,senderId);
                redisClient.set(redisKey,msg.isChatOffline,function(err,result){
                  if(err) console.trace(err);
                  var responseMsg = {
                    responseType: RESPONSE_TYPE.updateOfflineStatus,
                    isChatOffline: msg.isChatOffline
                  };
                  sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, senderId)).emit('message', JSON.stringify(responseMsg));
                  notifyUserStatus(senderId,1,msg.isChatOffline);
                })
              }
              break;

              case REQUEST_TYPE.getInitData:
                //init data includes: userId, groups, friends list, active thread
                var responseMsg = {
                responseType: RESPONSE_TYPE.initData,
                myId: senderId,
                isChatOffline: false
              };
              //TODO: can pipeline these requests for better performance?
              getUserRoster(senderId, function(results) {
                var users = {},roomName,status;
                var redisKeys = [],onlineUserIds=[];
                //associate userid
                _.each(results, function(user) {

                  roomName = _s.sprintf(SOCKET_USER_ROOM_FORMAT, user.userId);
                  if(sio.sockets.clients(roomName).length===0){
                    user.status = USER_STATUS.offline;
                  }else{
                    user.status = USER_STATUS.online;
                    redisKeys.push(_s.sprintf(USER_OFFLINE_STATUS,user.userId));
                    onlineUserIds.push(user.userId);
                  }
                  users[user.userId] = user;
                })
                //check if users appear offline
                redisClient.mget(redisKeys,function(err,results){
                  _.each(results,function(isChatOffline,index,results){
                    var uid = onlineUserIds[index];
                    if(isChatOffline == "true"){
                      users[uid].status = USER_STATUS.offline;
                    }
                  })

                  responseMsg.users = users;
                  getUserGroups(senderId, function(results) {
                    var groups = {};
                    _.each(results, function(group) {
                      groups[group.groupId] = group;
                    })
                    responseMsg.groups = groups;
                    getRecentThreads(senderId,new Date().getTime(),function(results){
                      var threadsToRemove =[];

                      _.each(results,function(thread,i,unreadThreads){
                        var tid = thread.threadId
                        var receiver = getThreadReceiver(tid,senderId);
                        var type = getThreadTypeFromId(tid);
                        if(type===THREAD_TYPE.groupThread){
                          if(!(receiver in groups)){
                            //user left group
                            threadsToRemove.push(tid);
                            results.splice(i,1);
                          }
                        }
                        if(type===THREAD_TYPE.oneOneThread){
                          if(!(receiver in users)){
                            //user unfriended 
                            threadsToRemove.push(tid);
                            results.splice(i,1);
                          }
                        }
                      })
                      responseMsg.recentThreads = results;

                      getUnreadThreads(senderId,function(results){
                        _.each(results,function(numUnread,tid,unreadThreads){
                          var receiver = getThreadReceiver(tid,senderId);
                          var type = getThreadTypeFromId(tid);
                          if(type===THREAD_TYPE.groupThread){
                            if(!(receiver in groups)){
                              //user left group
                              threadsToRemove.push(tid);
                              results.splice(i,1);
                            }
                          }
                          if(type===THREAD_TYPE.oneOneThread){
                            if(!(receiver in users)){
                              //user unfriended 
                              threadsToRemove.push(tid);
                              results.splice(i,1);
                            }
                          }
                        })
                        removeThreads(senderId,threadsToRemove,function(){
                          responseMsg.unreadThreads = results;
                          var redisKey = _s.sprintf(USER_OFFLINE_STATUS,senderId);
                          redisClient.get(redisKey,function(err,result){
                            responseMsg.isChatOffline = {"true":true,"false":false,nil:false}[result];
                            //TODO: can get threads details here instead
                            responseMsg.threads = {};
                            responseMsg.imgUrlPrefix = IMAGE_URL_PREFIX;
                            responseMsg.defaultProfileImgUrl = DEFAULT_PROFILE_IMAGE_URL;
                            client.send(JSON.stringify(responseMsg));
                          })
                        });
                      })
                    })
                  })
                })
              })
                break;

                case REQUEST_TYPE.sendOOThreadMessage:
                  if (hasKeys(msg, ["content", "receiverId"])) {
                  if (senderId !== msg.receiverId){
                    hasConnection(senderId, msg.receiverId, function(has_connection) {
                      msg.receiverId = parseInt(msg.receiverId);
                    if (has_connection) {
                      var threadId = redisKey = _s.sprintf(ONE_ONE_THREAD_FORMAT, Math.min(senderId, msg.receiverId), Math.max(senderId, msg.receiverId));
                      var redisKey2 = _s.sprintf(USER_THREADS_FORMAT,senderId);
                      var redisKey3 = _s.sprintf(USER_THREADS_FORMAT,msg.receiverId);
                      var redisKey4 = _s.sprintf(USER_UNREAD_THREADS_FORMAT,msg.receiverId);
                      var chatMessage = {
                        "senderId": senderId,
                        "content": msg.content,
                        "time": new Date().getTime()
                      };
                      var redisVal = JSON.stringify(chatMessage);
                      redisClient.multi()
                      .lpush(redisKey, redisVal)
                      .zadd(redisKey2,chatMessage.time,threadId)
                      .zadd(redisKey3,chatMessage.time,threadId)
                      .hincrby(redisKey4,threadId,1)
                      .exec(function(err, replies) {
                        if (err) {
                          console.log("Redis error " + err);
                        } else {
                          chatMessage.threadId = threadId;
                          chatMessage.responseType = RESPONSE_TYPE.newMessage;
                          sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, senderId)).emit('message', JSON.stringify(chatMessage));
                          sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, msg.receiverId)).emit('message', JSON.stringify(chatMessage));
                        }
                      });
                    } else {
                    }
                  })
                }
              }
              break;
              case REQUEST_TYPE.leaveMultiUserThread:
                if (hasKeys(msg, ["threadId"])) {
                var threadIdNum = msg.threadId;
                var threadId= _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT,threadIdNum);
                var threadRedisKey = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT, threadIdNum);
                var threadRedisKey2 = _s.sprintf(USER_THREADS_FORMAT, senderId);
                var threadRedisKey3 = _s.sprintf(USER_UNREAD_THREADS_FORMAT , senderId);

                var redisTrans = redisClient.multi().srem(threadRedisKey,senderId)
                .zrem(threadRedisKey2,threadId)
                .hdel(threadRedisKey3,threadId)
                .exec(function(err, result) {
                  if (err) {
                    console.log("Redis error" + err);
                  } else if (result[0] > 0) {
                    redisClient.smembers(threadRedisKey, function(err, members) {
                      _.each(members, function(val, i, arr) {
                        arr[i] = parseInt(val);
                      })
                      members.push(senderId);
                      _.each(members, function(userId) {
                        //sync thread info
                        var response = {
                          responseType: RESPONSE_TYPE.leaveMultiuserThread
                        };
                        response.threadId = _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT, threadIdNum);
                        response.userId = senderId;
                        sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, parseInt(userId))).emit('message', JSON.stringify(response));
                      })
                    })
                  }

                });

              }
              break;
              case REQUEST_TYPE.addFriendToMultiUserThread:
                if (hasKeys(msg, ["users", "threadId"])) {
                hasConnection(senderId, msg.users, function(has_connection) {
                  if (has_connection) {
                    var threadIdNum = msg.threadId;
                    var threadRedisKey = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT, threadIdNum);
                    redisClient.sadd(threadRedisKey, msg.users, function(err, result) {
                      if (err) {
                        console.log("Redis error" + err);
                      } else {
                        redisClient.smembers(threadRedisKey, function(err, members) {
                          _.each(members, function(val, i, arr) {
                            arr[i] = parseInt(val);
                          })
                          _.each(members, function(userId) {
                            //sync thread info
                            var response = {
                              responseType: RESPONSE_TYPE.updateMultiuserThreadInfo
                            };
                            response.threadId = _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT, threadIdNum);
                            response.users = members;
                            sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, parseInt(userId))).emit('message', JSON.stringify(response));
                          })
                        })
                      }
                    })
                  } else {
                  }
                })
              }
              break;
              case REQUEST_TYPE.sendMultiUserThreadMessage:
                if (hasKeys(msg, ["threadId", "content"])) {
                var threadIdNum = msg.threadId;
                var threadRedisKey = _s.sprintf(MULTIUSER_THREAD_USER_FORMAT, threadIdNum);
                redisClient.sismember(threadRedisKey, senderId, function(err, replies) {
                  if (err) {
                    console.log("redis error" + err);
                  } else {
                    if (replies === 0) {
                      console.log("user doesn't belong to thread");
                    } else {
                      var redisKey = threadId = _s.sprintf(MULTIUSER_THREAD_MSG_FORMAT, threadIdNum);
                      var redisKey2 = '',redisKey3='';
                      var chatMessage = {
                        "senderId": senderId,
                        "content": msg.content,
                        "time": new Date().getTime()
                      };
                      var redisVal = JSON.stringify(chatMessage);
                      var redisTrans = redisClient.multi().lpush(redisKey, redisVal);
                      chatMessage.threadId = threadId;
                      chatMessage.responseType = RESPONSE_TYPE.newMessage;
                      redisClient.smembers(threadRedisKey, function(err, members) {
                        _.each(members, function(memId) {
                          memId = parseInt(memId);
                          redisKey2 = _s.sprintf(USER_THREADS_FORMAT,memId);
                          redisTrans.zadd(redisKey2,chatMessage.time,threadId);
                          if(memId!==senderId){
                            redisKey3 = _s.sprintf(USER_UNREAD_THREADS_FORMAT,memId);
                            redisTrans.hincrby(redisKey3,threadId,1);
                          }
                        });
                        redisTrans.exec(function(err, replies) {
                          _.each(members, function(memId) {

                            sio.sockets. in (_s.sprintf(SOCKET_USER_ROOM_FORMAT, parseInt(memId))).emit('message', JSON.stringify(chatMessage));
                          });
                        })
                      })
                    }
                  }
                })
              }
              break;
              case REQUEST_TYPE.getRecentThreads:
                if(hasKeys(msg,["time"])){
                getRecentThreads(senderId,msg.time,function(results){
                  var responseMsg = {
                    responseType: RESPONSE_TYPE.getRecentThreads,
                    recentThreads: results
                  };
                  sio.sockets.in(_s.sprintf(SOCKET_USER_ROOM_FORMAT, senderId)).emit('message', JSON.stringify(responseMsg));
                })
              }
              break;

              case REQUEST_TYPE.markThreadAsRead:
                if(hasKeys(msg,["threadId"])){
                  var redisKey3= _s.sprintf(USER_UNREAD_THREADS_FORMAT,senderId);
                  redisClient.hdel(redisKey3,msg.threadId,function(err,result){
                    if(err) console.trace(err);
                    if(result>0){
                      var responseMsg = {
                        responseType: RESPONSE_TYPE.markThreadAsRead,
                        threadId: msg.threadId
                      };
                      sio.sockets.in(_s.sprintf(SOCKET_USER_ROOM_FORMAT, senderId)).emit('message', JSON.stringify(responseMsg));
                    }
                  });
              }
              break;
              case REQUEST_TYPE.sendGroupThreadMessage:
                if (hasKeys(msg, ["groupId", "content"])) {
                msg.groupId = parseInt(msg.groupId);
                getGroupMembers(msg.groupId, function(groupMemberIds) {
                  var threadId= redisKey = _s.sprintf(GROUP_THREAD_FORMAT, msg.groupId);
                  var redisKey2 = '',redisKey3='';
                  var chatMessage = {
                    "senderId": senderId,
                    "content": msg.content,
                    "time": new Date().getTime()
                  };
                  var redisVal = JSON.stringify(chatMessage);
                  chatMessage.threadId = threadId;
                  chatMessage.responseType = RESPONSE_TYPE.newMessage;
                  isUserInGroup = false;
                  var redisTrans = redisClient.multi().lpush(redisKey, redisVal);
                  for (var i = 0, l = groupMemberIds.length; i < l; i++) {
                    if (groupMemberIds[i].uid == senderId) {
                      isUserInGroup = true;
                    }
                    redisKey2= _s.sprintf(USER_THREADS_FORMAT,groupMemberIds[i].uid);
                    redisTrans.zadd(redisKey2,chatMessage.time,threadId);
                    if(groupMemberIds[i].uid!==senderId){
                      redisKey3= _s.sprintf(USER_UNREAD_THREADS_FORMAT,groupMemberIds[i].uid);
                      redisTrans.hincrby(redisKey3,threadId,1);
                    }
                  }
                  if (isUserInGroup) {
                    redisTrans.exec(function(err, replies) {
                      if (err) {
                        console.log("Redis error " + err);
                      } else {
                        _.each(groupMemberIds, function(memId) {
                          sio.sockets.in(_s.sprintf(SOCKET_USER_ROOM_FORMAT, memId.uid)).emit('message', JSON.stringify(chatMessage));
                        })
                      }
                    });
                  }else{
                    redisTrans.discard();
                  }
                });
              }
              break;
              case REQUEST_TYPE.getOldMessages:
                if (hasKeys(msg, ["msgIndex", "threadId"])) {
                /*request for  messages from msgIndex:
                 * 0:latest mmsg
                 * -1:oldest msg
                 */
                isUserInThread(senderId,msg.threadId,function(isInThread){
                  if(isInThread){
                    redisClient.lrange(msg.threadId, msg.msgIndex, msg.msgIndex + NUM_OLD_MESSAGES_PER_REQUEST, function(err, results) {
                      if (err) console.log("redis error: " + err);
                      var response = {
                        responseType: RESPONSE_TYPE.oldMessages,
                        threadId: msg.threadId
                      };
                      var oldMessages = [];
                      _.each(results, function(row, index, results) {
                        //results returned in latest-first order, need to reverse them to time order
                        oldMessages[results.length - 1 - index] = JSON.parse(row);
                      });
                      response.messages = oldMessages;
                      client.send(JSON.stringify(response));
                    });
                  }
                })
              }
              break;
              default:
                console.log("Invalid thread type");
            }
          } else {
            console.log("Invalid message format");
          }
        } catch(e) {
          console.trace(e);
        }
      }
    });
  });
  client.on('disconnect', function() {
    getUserId(client.handshake.headers['cookie'], function(userId) {
      if (userId === - 1) {
        client.disconnect("Session is invalid or expired. Please login again.")
      } else {
        var roomName = _s.sprintf(SOCKET_USER_ROOM_FORMAT, userId),
        connCount = sio.sockets.clients(roomName).length ;
        if(connCount===0){
          notifyUserStatus(userId,connCount);
        }
      }
    })
  });
});

app.use(function(err, req, res, next) {
  res.status(500);
  res.render('error', { error: err });
});

app.get('/', function(req, res) {
  res.sendfile(__dirname + '/index.html');
});

//TODO: finish this api, authen token
app.post('/api/recentThreads', function(req, res) {
  var token = req.body.token,
    uid = req.body.userId;

  if(token === API_TOKEN){
    if (isFinite(uid) && !isNaN(uid)){
      uid = parseInt(uid);
      getRecentThreads(uid,new Date().getTime() + 480,function(threads){
        res.send(JSON.stringify(threads));
      })
    }else{
      res.status(400);
      res.send("invalid uid");
    }
  }else{
    res.status(400);
    res.send("wrong token");
  }
});

app.post('/api/chatlog', function(req, res) {
  try
  {
    var token = req.body.token,
      offset = req.body.offset,
      tid = req.body.tid;
  }catch(e){
    //bad request
    res.status(400);
    res.send("Invalid offset or tid");
  }

  if(token === API_TOKEN){
    var start = offset;
    var end = offset + MAX_WEB_SERVICE_MESSAGES_PER_REQUEST;
    redisClient.lrange(tid,start,end, function(err, messages) {
      if(err) console.log(err);
      res.send(JSON.stringify(messages));
    })
  }else{
    res.status(400);
    res.send("wrong token");
  }
});

app.get('/profile_image.jpg', function(req, res) {
  res.sendfile(__dirname + '/profile_img.jpg');
});
app.use("/emoticons", express.static(__dirname + "/emoticons"));
