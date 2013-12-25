// TODO Make emoticonize work.
// TODO Make emoticonize, linkify configurable from the UI.
// TODO Make the server URL (SOCKET_SERVER) configurable from the UI.
// TODO Allow doing a ping test from the UI (to check if the server is up).
// TODO Decouple node server config and have a way by which it can be GENERATED for a given site.
// TODO Disable logging to the console unless when in debug mode.
// TODO Add friends to chat doesn't get cleared.
// TODO Thread icon can change to plus when thread is minimized.
// TODO Remove all inline CSS and add classes.
// TODO Allow whitelabelling friends, groups.
// TODO Keyboard navigation of the friend list.
// TODO Open thread indicator next to user/group.
// TODO Allow site to opt-out of group chat.

var chatClient = (function($, angular, io, ccScope) {
  var iosocket, myId, imgUrlPrefix,userDetailsRequestRecords = [];
  var THREAD_TYPE = {
    oneOneThread: 1,
    multiuserThread: 2,
    groupThread: 3
  },
  SOCKET_SERVER = Drupal.settings.teamieChat.serverUrl,
  ONE_ONE_THREAD_FORMAT = Drupal.settings.teamieChat.redisPrefix + "1.1.thread:{0}:{1}",
  GROUP_THREAD_FORMAT = Drupal.settings.teamieChat.redisPrefix + "group.thread:{0}",
  NUM_OLD_MESSAGES_PER_REQUEST = 50,

  REQUEST_TYPE = {
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
  },
  RESPONSE_TYPE = {
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
  },
  USER_STATUS ={offline:0, online:1},
 
  DEFAULT_APPLY_INTERVAL = 100, // delay interval to update message list view according to model
  MAX_VISIBLE_THREADS = 0,
  //1 mins to separate to new block
  MAX_CHAT_MSG_BLOCK_TIME = 60 * 1000;


  //init angular app
  angular.module('app', ['filter']);
  angular.module('filter', []).filter('escapeHTML', function() {
    return escapeHTML;
  }).filter('linkify', function() {
    return linkify;
  })
    .filter('emoticonize', function() {
    return emoticonize;
  });
  angular.module('app', ['ngSanitize', 'filter' ]).directive('chatInput', function() {
    return function(scope, elm, attrs) {
      $(elm).bind("keydown", function(e) {
        scope.chatInputKeyDown(e, this);
      });
    };
  }).directive('updateTitle', function($parse) {
    return {
      link: function(scope, el,attrs) {
        scope.$watch("countThreadsWithNewMessages()",function(newValue,oldValue,scope) {
          if(scope.$parent.originalTitle === undefined){
            scope.$parent.originalTitle = document.title;
          }
          if(oldValue===0){
            scope.$parent.originalTitle = document.title;
          }
          if(newValue!==0){
            document.title = "({0}) ".f(newValue) + scope.$parent.originalTitle;
          }else{
            document.title = scope.$parent.originalTitle ;
          }
        });
      }
    };

  }).directive('threadTitle', function($parse) {
    //trim the innerhtml until el fits the width of 1 line
    return {
      link: function(scope, el,attrs) {

        var watchFunc ;
        if(attrs.threadTitle === "dialog-title"){
          watchFunc = "getThreadTitle('{0}')".f(scope.tid);
        }else if(attrs.threadTitle === "archive-tab"){
          watchFunc = "getThreadTitleArchiveTab('{0}')".f(scope.tid);
        }

        scope.$watch(watchFunc,function(newVal,oldVal,scope) {
          //need to make sure container is visible, or this will fail :p
          var isVisible=el.is(":visible");
          if(!isVisible) {
            el.parents(".chat-dialog-container").show();
          }

          var i=0, targetHeight = el.html('.').height(),originalText=newVal;//targetHeight = height of single line el
          el.html(originalText);
          while(el.outerHeight()>targetHeight){
            (el).html(originalText.substring(0,originalText.length-i)+"...");
            i++;
            if(i > originalText.length){
              break;
            }
          }
          (el).attr("title",originalText);

          if(!isVisible) {
            el.parents(".chat-dialog-container").hide();
          }

        });
      }
    };

  }).directive('ngUserProfileDrag', function($parse) {
    return function(scope, element, attrs) {
      $(element).attr("draggable","true").on("dragstart", function(e){
          e.originalEvent.dataTransfer.setData("Text", attrs.userid);
      });
    };
  }).directive('chatMessages', function($parse) {
    return {
      link: function(scope, el, attr) {
        scope.$watch('threads["{0}"].messages.length'.f(scope.tid), function(newVal,oldVal,scope) {
          var html = "",htmlTemp;
          var messages = scope.$parent.threads[scope.tid].messages;
          for(i=0;i<messages.length;i++){
            var msg = messages[i];
            var sender = scope.$parent.users[msg.senderId];

            if(scope.$parent.isFirstInSection(i,messages)){
              var htmlBeginChatBlock = "\x3Cdiv class=\"chat-block\"\x3E";
              var htmlEndChatBlock = "\x3C\x2Fdiv\x3E",filteredMsg;

              //formats: time, sender name, image, content
              if(i===0){
                htmlTemp ="\x3Cdiv\x3E\x3Cp class=\"chat-seperator\"\x3E\n\x3Cimg class=\"img-circle chat-profile-picture\" title=\"{1}\" style=\"pointer-events: all\" src=\"{2}\"\x3E\x3Cspan class=\"chat-message chat-inline-picture \" \x3E{3}\x3C\x2Fspan\x3E\n\x3C\x2Fp\x3E\x3C\x2Fdiv\x3E";
              }else{
                htmlTemp ="\x3Cdiv\x3E  \x3Cdiv style=\"text-align:right \" class=\"timeago-container\"\x3E\n\x3Cabbr class=\"label label-default timeago\" title=\"{4}\"\x3E{0}\x3C\x2Fabbr\x3E\n\x3C\x2Fdiv\x3E\n\x3Cp class=\"chat-seperator\"\x3E\n\x3Cimg class=\"img-circle chat-profile-picture\" title=\"{1}\" style=\"pointer-events: all\" src=\"{2}\"\x3E\x3Cspan class=\"chat-message chat-inline-picture \" \x3E{3}\x3C\x2Fspan\x3E\n\x3C\x2Fp\x3E\x3C\x2Fdiv\x3E";
              }
              var relativeTime = scope.getMsgBlockTimeStamp(i,messages);
              var absoluteTime = scope.getFriendlyTimeString(msg.time);
              // filteredMsg = emoticonize(linkify(escapeHTML(messages[i].content)));
              filteredMsg = linkify(escapeHTML(messages[i].content));

              var imageUrl = scope.$parent.getProfileImageURL(sender.image);
              if(i>0){
                html+= htmlEndChatBlock;
              }
              html+=htmlBeginChatBlock;
              html += htmlTemp.f(relativeTime,sender.name,imageUrl,filteredMsg,absoluteTime);
            }else{
              htmlTemp = "\x3Cp class=\"chat-message\"\x3E{0}\x3C\x2Fp\x3E";
              // filteredMsg = emoticonize(linkify(escapeHTML(messages[i].content)));
              filteredMsg = linkify(escapeHTML(messages[i].content));
              html += htmlTemp.f(filteredMsg);
            }
          }
          el.html(html);

        });
      }
    };
  }).directive('chatRosterDropdown', function($parse) {
    return {
      link: function(scope, $el, attrs, ctrls){
        var users;
        $.each(['threads["{0}"].users'.f(scope.tid),'friends'],function(i,watchExp){

          scope.$watch(watchExp,function() {
            users = scope.getFriendsNotInThread(scope.tid);
            var strHTML = "",
            strTemp = "\x3Coption value={0}\x3E{1}\x3C\x2Foption\x3E";//<option value={0}>{1}</option>

            $.each(users,function(i,user){
              strHTML += strTemp.f(user.userId,user.name);
            })
            $el.html(strHTML);
            $($el).trigger("liszt:updated");
          },true);
        })
      }

    }
  }).directive('ngUserProfileDrop', function($parse) {
    return function(scope, element, attrs) {
      var tid = scope.tid;
      $(element).on("drop", function(e) {
        e.preventDefault();
        var userId = e.originalEvent.dataTransfer.getData("Text");
        if (isNumeric(userId)) {
          scope.addFriendToThread(tid, [userId]);
        }
      });
      $(element).on("dragover dragenter", function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
    };
  }).directive('focusMe', function($timeout) {
    return {
      link: function(scope, element) {
        scope.$watch('showFriendListFilter', function() {
          if(scope.showFriendListFilter) {
            $timeout(function() {
              element[0].focus();
            });
          }
        });
      }
    }
  }).directive('chatContainer', function($timeout){
    //1.focus the text box when focusThread is me
    //2.mark msg as read when my textbox gets focus
    return {
      link: function(scope, $el, attrs, ctrls){
        scope.$watch(function() {
          jQuery('.timeago').once('timeago', function() {
            $(this).timeago();
          });
        });
        scope.$watch("focusThread",function(){
          if(scope.focusThread==scope.tid){

            $timeout(function(){
              $($el[0]).find("input[id^='chatText']")[0].focus();
              scope.$apply(function(){
                scope.$parent.focusThread = null;
              });
            })
          }
        })
        els = [$el[0]].concat($.makeArray($($el[0]).find("*")));
        $(els).on("focus",function(e){
          $timeout(function(){
            scope.$apply(function(){
              (scope.$parent||scope).focusedThread = attrs.threadid;
              scope.markThreadAsRead(attrs.threadid);
            })
          })
        }).on("blur",function(e){
          (scope.$parent||scope).focusedThread = null;
        });

        els = $.makeArray($($el[0]).find(":not(input)"));
        $(els).on("click",function(e){
          $timeout(function(){
            scope.$apply(function(){
              (scope.$parent||scope).focusedThread = null;
              scope.markThreadAsRead(attrs.threadid);
            })
          })
        })
      }
    }
  }).directive('archiveTab', function(){
    //this directive features infinite scrolling: get old threads when scroll down

    return {
      priority: 1,
      restrict: 'A',
      link: function(scope, $el, attrs, ctrls){
        var el = $el[0];
        $(el).scroll(function(e) {
          if (this.scrollTop == this.scrollHeight - this.offsetHeight) {
            scope.getOldThreads(threadsIndex);
          }
        });
      }
    };

  }).directive('friendList', function(){

    return {
      priority: 1,
      restrict: 'A',
      link: function(scope, $el, attrs, ctrls){
        var el = $el[0];
        $(el).scroll(function(e) {
          if(scope.activeView==="archive"){
            var threadId = $(this).parents(".chat-dialog-container").attr("threadid");
            // if (
            if (this.scrollTop >= (this.scrollHeight - this.offsetHeight)) {
              scope.getRecentThreads();
            }
          }
        });
      }
    };
  }).directive('chatContent', function(){
    //this directive features infinite scrolling: get old msgs when scroll indicator is at top
    //and glue mod when scroll indicator is at bottom (autoscroll to bottom when new message is arrived);

    return {
      priority: 1,
      restrict: 'A',
      link: function(scope, $el, attrs, ctrls){
        var el = $el[0];
        $(el).scroll(function(e) {
          var threadId = $(this).parents(".chat-dialog-container").attr("threadid");
          if (this.scrollTop === this.scrollHeight - this.offsetHeight){
            scope.threads[threadId].autoScroll = true;
          }else{
            scope.threads[threadId].scrollTop = this.scrollTop;
            scope.threads[threadId].autoScroll = false;
          }
          if (this.scrollTop == 0) {
            var msgIndex = scope.threads[threadId].messages.length;
            scope.getOldMessages(threadId, msgIndex);
          }
        });
        scope.$watch(function(){
          if(scope.threads[scope.tid].autoScroll){
            el.scrollTop = el.scrollHeight ;
          }else{
            var tmpScrollTop =scope.threads[scope.tid].scrollTop ;
            if(typeof tmpScrollTop === 'number'){
              el.scrollTop = tmpScrollTop;
            }else{
              el.scrollTop = el.scrollHeight;
            }
          }
        });
      }
    };
  }).controller('ChatController', ['$scope', function($scope, $injector) {

    $(window).on('load resize',function(){
      $scope.$apply(function(){
        MAX_VISIBLE_THREADS = Math.floor($(this).innerWidth()/280);
      });
    });

    /***** SOCKET IO *****/
    window.io = iosocket = io.connect(SOCKET_SERVER); 
    //get active threads
    iosocket.once('connect', function() {

      iosocket.send(JSON.stringify({
        "requestType": REQUEST_TYPE.getInitData
      }));

      iosocket.on('message', function(message) {
        var msg = JSON.parse(message);
        if ('responseType' in msg) {
          switch (msg.responseType) {
          case RESPONSE_TYPE.usersDetails:
            $(msg.users).each(function(i, user) {
              $scope.users[user.userId] = user;
            })
            $scope.$apply();
            break;
          case RESPONSE_TYPE.getMultiuserThreadDetails:
            $scope.$apply(function(){
            // debugger;

            if ($scope.threads[msg.id]) {
              var threadUsers = $scope.threads[msg.id].users = $scope.threads[msg.id].users || [];

              $scope.checkUserCache(msg.users);
              var unknownUsers = [];
              $(msg.users).each(function(i, uid) {
                if (threadUsers.indexOf(uid) === - 1) {
                  threadUsers.push(uid);
                  if (!$scope.users[uid]) unknownUsers.push(uid);
                }
              });
            }
          })
            break;
          case RESPONSE_TYPE.markThreadAsRead:
            $scope.$apply(function(){
            $scope.initThread(msg.threadId);
            $scope.threads[msg.threadId].numUnreadMessages=0;
          });
            break;
          case RESPONSE_TYPE.updateOfflineStatus:
            $scope.$apply(function(){
            $scope.isChatOffline = msg.isChatOffline;
          })
            break;
          case RESPONSE_TYPE.initData:
            $scope.$apply(function() {
              $scope.activeView = 'friends';
              $scope.isFriendListMinimized = true;
              window.cc = $scope;

              myId = parseInt(msg.myId);
              $scope.isChatOffline = msg.isChatOffline;
              $scope.users = msg.users;
              $scope.friends = [];

              $(Object.keys($scope.users)).each(function() {
                if (this != myId) {
                  $scope.friends.push($scope.users[this]);
                }
              });
              $scope.friends.sort(compareUserName);
              $scope.groups = msg.groups;
              $scope.threads = msg.threads;
              $.each(msg.recentThreads,function(i,thread){
                $scope.initThread(thread.threadId);
                $scope.threads[thread.threadId].messages= thread.messages;
                $scope.threads[thread.threadId].lastRequestedMsgIndex = thread.messages.length-1;
              })
              if(msg.recentThreads.length>0){
                var lastThreadId = msg.recentThreads.pop().threadId;
                var numMsg = $scope.threads[lastThreadId].messages.length;
                //guarantee all threads after this time are in our cache
                $scope.oldestRecentThreadTime =  $scope.threads[lastThreadId].messages[numMsg-1].time;
              }else{
                $scope.oldestRecentThreadTime = new Date().getTime();
              
              }

              $.each(msg.unreadThreads,function(threadId,numUnreadMessages){
                $scope.initThread(threadId);
                $scope.threads[threadId].numUnreadMessages =  numUnreadMessages;
              })
              $scope.imgUrlPrefix = msg.imgUrlPrefix;
              $scope.defaultProfileImgUrl = SOCKET_SERVER + msg.defaultProfileImgUrl;
              $scope.isChatReady = true;

              $.each(msg.unreadThreads,function(threadId){
                $scope.openThread(threadId);
              })

            });

            break;
          case RESPONSE_TYPE.getRecentThreads:
            // debugger;
            $scope.$apply(function(){
            $.each(msg.recentThreads,function(i,thread){
              if(!$scope.threads[thread.threadId]){
                $scope.initThread(thread.threadId);
                $scope.threads[thread.threadId].messages= thread.messages;
                $scope.threads[thread.threadId].lastRequestedMsgIndex = thread.messages.length-1;
              }
            })
            var lastThreadId = msg.recentThreads.pop().threadId;
            var numMsg = $scope.threads[lastThreadId].messages.length;
            $scope.oldestRecentThreadTime =  $scope.threads[lastThreadId].messages[numMsg-1].time;
          })
            break;
          case RESPONSE_TYPE.updateMultiuserThreadInfo:
            if (msg.threadId in $scope.threads) {
            $scope.$apply(function(){
              $scope.checkUserCache(msg.users);
              $scope.threads[msg.threadId].users = msg.users;
            })
          }else{
            $scope.$apply(function(){
              $scope.openThreadAndFocus(msg.threadId);
              $scope.checkUserCache(msg.users);
              $scope.threads[msg.threadId].users = msg.users;
            })
          }
            break;
            //else, initMultiuserThread
          case RESPONSE_TYPE.initMultiuserThread:
            $scope.$apply(function(){

            $scope.checkUserCache(msg.users);
            $scope.openMultiuserThread(msg.threadId, msg.originalThread, msg.users);
          })
            break;

          case RESPONSE_TYPE.leaveMultiuserThread:
            $scope.$apply(function(){

            var thread = $scope.threads[msg.threadId];
            var index = thread.users.indexOf(msg.userId);
            if (index !== - 1) {
              while (index !== - 1) {
                thread.users.splice(index, 1);
                index = thread.users.indexOf(msg.userId);
              }
              if (msg.userId === myId) {
                //remove this from active threads
                var index = $scope.openThreads.indexOf(msg.threadId);
                while (index !== - 1) {
                  $scope.openThreads.splice(index, 1);
                  index = $scope.openThreads.indexOf(msg.threadId);
                }
                delete $scope.threads[msg.threadId];
              } else {
              }
            }
          })

          break;
          case RESPONSE_TYPE.newMessage:
            if ($scope.threads[msg.threadId]) {
            $scope.threads[msg.threadId].messages.push({
              senderId: msg.senderId,
              time: msg.time,
              content: msg.content
            });
            $scope.threads[msg.threadId].lastRequestedMsgIndex++;
            $scope.threads[msg.threadId].numUnreadMessages++;
            if($scope.focusedThread === msg.threadId){
              $scope.markThreadAsRead(msg.threadId);
            }
            if(msg.senderId === myId){
              $scope.threads[msg.threadId].numUnreadMessages=0;
            }
            $scope.checkUserCache(msg.senderId);
          } else {
            $scope.initThread(msg.threadId);
            $scope.checkUserCache(msg.senderId);
            if(msg.senderId === myId){
              $scope.threads[msg.threadId].numUnreadMessages=0;
            }else{
              $scope.threads[msg.threadId].numUnreadMessages++;
            }
          }

          if($scope.openThreads.indexOf(msg.threadId)===-1){
              $scope.openThread(msg.threadId);
            }
            $scope.needApply = true;
            break;

            case RESPONSE_TYPE.oldMessages:
              var oldMessages = msg.messages;
            var removeIndex = oldMessages.length;

            $scope.initThread(msg.threadId);
            //old messages from the server have at least one common message as what stored in the cache, remove them before prepending
            var chatThread = $scope.threads[msg.threadId];
            for (var i = oldMessages.length - 1; i >= 0; i--) {
              var oldMsg = oldMessages[i];
              var currMsg = undefined;
              var index = chatThread.messages.length - 1 - i;
              if (index < 0) break;
              else currMsg = chatThread.messages[index];

              if (! ((typeof currMsg === 'object') && (oldMsg.content === currMsg.content) && (oldMsg.time === currMsg.time) && (oldMsg.userId === currMsg.userId))) {
                removeIndex = i + 1;
                break;
              }
            }
            oldMessages.splice(removeIndex, oldMessages.length);
            var allSenders = [];
            $(oldMessages).each(function(i, msg) {
              allSenders.push(msg.senderId);
            })
            $scope.checkUserCache(allSenders);


            if ((chatThread.messages[0])&&(chatThread.messages.length>1)) {
              chatThread.messages[0].forceSeparateBlock = true;
            }
            var escapedThreadId = escapeSelector(msg.threadId);
            var contentDiv = $('.chat-dialog-container[threadId="{0}"]'.f(escapedThreadId)).find(".chat-dialog-content")[0];

            if(contentDiv){
              var oldScrollHeight = contentDiv.scrollHeight;
              var currScrollTop = $scope.threads[msg.threadId].scrollTop || 0;

              $scope.$apply(function(){
                chatThread.messages = oldMessages.concat(chatThread.messages);
              });
              var newScrollHeight = contentDiv.scrollHeight;
              contentDiv.scrollTop = currScrollTop + newScrollHeight - oldScrollHeight;
            }else{
              //this dialog is closed by the time old messages arrive
              $scope.$apply(function(){
                chatThread.messages = oldMessages.concat(chatThread.messages);
              });
            }

            break;
            case RESPONSE_TYPE.updateUserStatus:
              $scope.$apply(function(){
              if('users' in $scope){
                if (msg.userId in $scope.users){
                  $scope.users[msg.userId].status = msg.status;
                }
              }
            })
            break;
          default:
            throw new Error("unknown response type");
          }
        }
      });
      iosocket.on('disconnect', function(msg) {
        $scope.users = {};
        $scope.friends = {};
        $scope.groups = {};
        $scope.threads = {};
        $scope.openThreads = {};
        $scope.isChatReady = false;
        $scope.isChatOffline = true;
        $scope.$apply();
      });
    });
    //END OF SOCKET IO
    //
    //
    //compare threads by last message time
    $scope.compareThreadsByTime = function(tid1,tid2){
      try {
        var threads = $scope.threads,
        thread1 = threads[tid1],thread2 = threads[tid2],
        time1 =!!thread1.messages.length?thread1.messages[thread1.messages.length-1].time:0 ,
        time2 =!!thread2.messages.length?thread2.messages[thread2.messages.length-1].time:0 ;

        return time1 - time2;
      } catch (e) {
        return undefined;
      }
    }
    $scope.markThreadAsRead = function(threadId){
      if($scope.threads[threadId].numUnreadMessages>0){
        $scope.threads[threadId].numUnreadMessages = 0;
        iosocket.send(JSON.stringify({
          "requestType": REQUEST_TYPE.markThreadAsRead,
          "threadId": threadId
        }))
      }
    }
    $scope.getProfileImageURL = function(fileName){
      if((fileName == "null")||(fileName === null)){
        return $scope.defaultProfileImgUrl;
      }
      return $scope.imgUrlPrefix + fileName;
    }
    $scope.getListOfGroupsSortedByName = function(timeStamp) {
      var list = [];
      $.each($scope.groups,function(i,group){
        list.push(group);
      });
      return list.sort(function(g1,g2){return g1.name.localeCompare(g2.name)});
    }
    
    $scope.getFriendlyTimeString = function(timeStamp) {
      var date = new Date(timeStamp);
      return (function() {
        function pad(number) {
          var r = String(number);
          if (r.length === 1) {
            r = '0' + r;
          }
          return r;
        }
        return date.getUTCFullYear()
          + '-' + pad(date.getUTCMonth() + 1)
          + '-' + pad(date.getUTCDate())
          + 'T' + pad(date.getUTCHours())
          + ':' + pad(date.getUTCMinutes())
          + ':' + pad(date.getUTCSeconds())
          + '.' + String((date.getUTCMilliseconds()/1000).toFixed(3)).slice(2, 5)
          + 'Z';
      })();
    }

    $scope.isOneOneChatAndOffline = function(threadId){
      var thread = $scope.threads[threadId];
      if(thread){
        if ((thread.type === THREAD_TYPE.oneOneThread) && ($scope.users[thread.sendTo].status === USER_STATUS.offline))
          return true;
      }
      return false;
    }
    $scope.getListOfFriends = function(){
      var onlineFriends = [], offlineFriends = [];
      $($scope.friends).each(function(i,friend,friends){
        if(friend.status === USER_STATUS.online){
          onlineFriends.push(friend);
        }else{
          offlineFriends.push(friend);
        }
      })
      return onlineFriends.concat(offlineFriends);

    }
    $scope.filterObjectByName = function(obj) {

      if (typeof obj.name === "undefined") {
        return false;
      } else if (typeof $scope.friendListFilterText === "undefined") {
        return true;
      } else {
        return obj.name.toLowerCase().indexOf($scope.friendListFilterText.toLowerCase()) > - 1;
      }

    };
    //request for old msgs, from msgIndex
    $scope.getRecentThreads = function() {
      var oldestRecentThreadTime = $scope.oldestRecentThreadTime || 0;
      var lastRequestedThreadTime = $scope.lastRequestedThreadTime || -1;
      if(lastRequestedThreadTime<oldestRecentThreadTime){
        //not yet requested for thread after oldestrecentthreadtime
        $scope.lastRequestedThreadTime = oldestRecentThreadTime;
        if (iosocket) {
          iosocket.send(JSON.stringify({
            "requestType": REQUEST_TYPE.getRecentThreads,
            "time": $scope.oldestRecentThreadTime
          }))
        }
      }
    }
    $scope.getOldMessages = function(threadId, msgIndex) {

      var lastRequestedMsgIndex = $scope.threads[threadId].lastRequestedMsgIndex;
      if(lastRequestedMsgIndex === undefined) lastRequestedMsgIndex = -1;
      if (lastRequestedMsgIndex < msgIndex) {
        if (iosocket) {
          iosocket.send(JSON.stringify({
            "requestType": REQUEST_TYPE.getOldMessages,
            "threadId": threadId,
            "msgIndex": msgIndex,
          }))
          $scope.threads[threadId].lastRequestedMsgIndex = msgIndex;
        }
      }
    };

    $(".friendListFilter").keyup(function(e) {
      var me = this;
      if ((e.keyCode === 13)) {
        var arr = $.makeArray($("div.chat-list-item"));
        if (arr.length >= 1) {
          $(arr[0]).trigger("click");
          $scope.$apply('friendListFilterText = "";')
        }
      }
    });
    //to get the ids of recent threads, sorted in time order
    //all thread has latest time more recent than oldestrecentthreadtime
    $scope.getSafeRecentThreadIds = function(){
      var threadIds = [];
        $.each($scope.threads,function(i,thread){
          var numMsg=thread.messages.length;
          if(numMsg>0){
            if(thread.messages[numMsg-1].time >= $scope.oldestRecentThreadTime){
              threadIds.push(thread.threadId);
            }
          }
        })
      try{
        return threadIds.sort($scope.compareThreadsByTime).reverse();
      }catch(e){
        return [];
      }
    }
    
    /**
     * Connects/Disconnects the user from the Chat service.
     *
     * @param bool isOffline
     *   Boolean indicating whether the chat must be turned off.
     */ 
    $scope.setChatStatus = function(isOffline) {
      $scope.isChatOffline = isOffline;
      iosocket.send(JSON.stringify({
        "requestType": REQUEST_TYPE.updateOfflineStatus,
        "isChatOffline": isOffline
      }));
    };
    
    /**
     * Returns the maximum number of threads that can be visible to the user
     * at any point in time.
     *
     * @return Number
     */
     $scope.getMaximumVisibleThreads = function() {
       return MAX_VISIBLE_THREADS - 1;
     }
    
    /**
     * Returns a set of threads that are currently visible to the user.
     *
     * @return array
     *   A set of threadIds.
     */
    $scope.getVisibleThreads = function() {
      if ($scope.isChatOffline) {
        return [];
      }
      else {
        var showOnly = this.getMaximumVisibleThreads();
        var visibleThreads = $scope.openThreads.slice(0, showOnly);
        return visibleThreads.reverse();
      }  
    };

    $scope.getUsersDetails = function(userIds) {
      var index;
      if (typeof userIds === "number") userIds = [userIds];
      $.each(userIds,function(i,uid){
        if(userDetailsRequestRecords[uid]>0){
          userIds.splice(i,1);
        }else{
          userDetailsRequestRecords[uid]=new Date().getTime();
        }
      })
      if (userIds.length > 0) {
        var req = {
          requestType: REQUEST_TYPE.getUsersDetails,
          userIds: userIds
        };
        iosocket.send(JSON.stringify(req));
      }
    };
    $scope.getMultiuserThreadDetails = function(id) {
      var threadIdNum = $scope.getThreadReceiver(id);
      var req = {
        requestType: REQUEST_TYPE.getMultiuserThreadDetails,
        threadIdNum: threadIdNum
      };
      iosocket.send(JSON.stringify(req));
    };

    //to check if the user(s) is in the cache
    //and ask the server for users details if not
    $scope.checkUserCache = function(userIds) {
      if (typeof userIds !== 'object') userIds = [userIds];
      var unknownUsers = [];
      $(userIds).each(function(i, uid) {
        if (!$scope.users[uid]) {
          unknownUsers.push(uid);
          $scope.users[uid] = {};
        }
        if (unknownUsers.length !== 0) {
          $scope.getUsersDetails(unknownUsers);
        }
      })
    }

    window.lazyApply = function() {
      if ($scope.needApply) {
        $scope.$apply();
        $scope.needApply = false;
      }
    }
    setInterval("lazyApply()", DEFAULT_APPLY_INTERVAL);

    $scope.openMultiuserThread = function(threadId, originalThread, users) {
      var i = $scope.openThreads.indexOf(originalThread);
      if ((originalThread) && (i !== - 1)) {
        //multiuser is created from this original thread, replace it.
        $scope.openThreadAndFocus(threadId, i, users);
      } else {
        $scope.openThreadAndFocus(threadId, null, users);
      }
    }
    $scope.openOneOneThread = function(userId) {
      userId = parseInt(userId);
      if ((myId) && (!isNaN(userId))) {
        var userIds = [userId, myId].sort(compareNumber);
        var threadId = ONE_ONE_THREAD_FORMAT.f(userIds[0], userIds[1]);
        $scope.openThreadAndFocus(threadId);
      }
    }
    $scope.openGroupThread = function(groupId) {
      var threadId = GROUP_THREAD_FORMAT.f(groupId);
      $scope.openThreadAndFocus(threadId);
    }
    //make sure that a thread with threadId exists in the cache
    $scope.initThread = function(threadId, users) {
      var newThread = {
        threadId: threadId,
        autoScroll: true,
        lastRequestedMsgIndex: -1,
        numUnreadMessages: 0
      };
      if (! (newThread.threadId in $scope.threads)) {
        newThread.type = $scope.getThreadTypeFromId(threadId);
        newThread.messages = [];
        if (newThread.type === THREAD_TYPE.multiuserThread) {
          if(users === undefined){
            $scope.getMultiuserThreadDetails(threadId);
          }else{
            newThread.users = users;
          }

        }
        newThread.sendTo = $scope.getThreadReceiver(threadId, newThread.type, myId);
        $scope.threads[newThread.threadId] = newThread;
      }
      return threadId;
    }
    //to open a thread and focus it
    $scope.openThreadAndFocus = function(threadId, oldThreadIndex, users) {
      $scope.openThread(threadId,oldThreadIndex,users);
      $scope.focusThread = threadId;
      $scope.threads[threadId].minimized=false;
    }

    //to open a new thread
    //or move a thread next to friendlist if it's already opened
    //if oldindex is defined,
    //replace the current oldIndex thread with this new one, e.g: when creating multiuserThread from single thread
    $scope.openThread = function(threadId, oldThreadIndex, users) {
      $scope.initThread(threadId, users);
      var index = $scope.openThreads.indexOf(threadId);
      if (index===-1) {
        var shouldReplaceOldThread = false;
        if (typeof oldThreadIndex === 'number'){
          var oldThreadId = $scope.openThreads[oldThreadIndex];
          if($scope.threads[oldThreadId].numUnreadMessages===0){
            shouldReplaceOldThread=true;
          };
        };
        if (shouldReplaceOldThread) {
          //e.g.: multiuser thread is formed by adding more friends to One One thread
          //close one one thread position, open multiuser thread here
          $scope.openThreads[oldThreadIndex] = threadId;
        } else {
          $scope.openThreads.unshift(threadId);
        };
      }else{
        $scope.openThreads.move(index,0);
      }
      var numMsgs = $scope.threads[threadId].messages.length;
      if(numMsgs<NUM_OLD_MESSAGES_PER_REQUEST){
        //no messages in this threads, or only get 1 latest messages in the init data
        //get more so that the scrollbar is visible, scroll top is triggered
        $scope.getOldMessages(threadId, numMsgs);
      }
      
    }
    myId = null; //test
    $scope.users = Object();
    $scope.openThreads = [];
    $scope.users = {};
    $scope.isFirstInSection = function(index, messages) {
      if (index === 0) {
        return true;
      } else {
        var currMsg = messages[index];
        var prevMsg = messages[index - 1];
        if (currMsg.forceSeparateBlock) {
          return true;
        } else if ((currMsg.time - prevMsg.time) > MAX_CHAT_MSG_BLOCK_TIME) {
          return true;
        } else {
          return currMsg.senderId !== prevMsg.senderId;
        }
      }
    }

    $scope.addMessage = function(msgCount) {
      if (!msgCount) msgCount = 1;
      for (var i = 0; i < msgCount; i++) {
        $scope.threads[1].messages.push({

          senderId: myId,
          time: new Date().getTime(),
          content: "test message " + i,
        });
      }
      $scope.$apply();
    }
    $scope.threads = {};
    $scope.countThreads = function() {
      return Object.keys($scope.openThreads).length;
    }
    $scope.getMyName = function() {
      if (myId && $scope.users[myId]) {
        return $scope.users[myId].name;
      } else {
        return "not logged in";
      }
    }

    $scope.sendMessage = function(threadId) {
      var textBox = document.getElementById("chatText-" + threadId); //jquery selector uses regexp and messes up with the dot
      var chatContent = textBox.value; //jquery selector uses regexp and messes up with the dots in thread id
      switch ($scope.threads[threadId].type) {
      case THREAD_TYPE.oneOneThread:

        if (chatContent !== "") {
          iosocket.send(JSON.stringify({
            "content": chatContent,
            "requestType": REQUEST_TYPE.sendOOThreadMessage,
            "receiverId": $scope.threads[threadId].sendTo
          }));

          textBox.value = "";
        }
        break;
      case THREAD_TYPE.groupThread:

        if (chatContent !== "") {
          iosocket.send(JSON.stringify({
            "content": chatContent,
            "requestType": REQUEST_TYPE.sendGroupThreadMessage,
            "groupId": $scope.threads[threadId].sendTo
          }));

          textBox.value = "";
        }
        break;
      case THREAD_TYPE.multiuserThread:
        if (chatContent !== "") {
          iosocket.send(JSON.stringify({
            "content": chatContent,
            "requestType": REQUEST_TYPE.sendMultiUserThreadMessage,
            "threadId": $scope.threads[threadId].sendTo
          }));
          textBox.value = "";
        }
        break;
      default:
        console.log("unknown thread type!");
      }
      $scope.$apply(function(){
        $scope.threads[threadId].autoScroll = true;
      })
    };

    $scope.getMsgBlockTimeStamp = function(index,msgs) {
      for(var i = index+1;i<msgs.length;i++){
        if ($scope.isFirstInSection(i,msgs)){
          break;
        }
      }
      var timeStamp = msgs[i-1].time;
     return Math.floor(timeStamp/1000);//convert to UNIX timestamp (ms -> sec)
    }

    $scope.countThreadsWithNewMessages = function() {
      var count = 0;
      for(i=0;i<$scope.openThreads.length;i++){
        if($scope.threads[$scope.openThreads[i]].numUnreadMessages>0){
          count++;
        }
      }
      return count;
    }

    $scope.getThreadTitleArchiveTab = function(threadId) {
      var thread = $scope.threads[threadId];
      var title = "";
      if (typeof thread !== "object") return "Loading...";
      switch (thread.type) {
      case THREAD_TYPE.oneOneThread:
        if (typeof $scope.users[thread.sendTo] === 'undefined') title = "dumb";
        var user = $scope.users[thread.sendTo];
        title += user.name ;
        break;
      case THREAD_TYPE.multiuserThread:
        var participants = $scope.threads[threadId].users;
        if (!participants) return "Loading...";
        for (i = 0; i < participants.length; i++) {
          var userId = participants[i];
          if (($scope.users[userId] === undefined) || (userId === myId)) {
            continue;
          } else {
            title += title.length > 0 ? ", ": "";
            title += ($scope.users[userId].name||"loading... ").split(" ")[0];
          }
        }
        title = "({0}) ".f(participants.length) + title + " and me";
        break;
      case THREAD_TYPE.groupThread:
        title = "Group: " + $scope.groups[thread.sendTo].name;
        break;
      default:
        title = "Unknown";
      }
      var messages = $scope.threads[threadId].messages;
      return title;
    }
    $scope.getThreadTitle = function(threadId) {
      var thread = $scope.threads[threadId];
      var title = "";
      if (typeof thread !== "object") return "Loading...";
      switch (thread.type) {
      case THREAD_TYPE.oneOneThread:
        if (typeof $scope.users[thread.sendTo] === 'undefined') title = "dumb";
        var user = $scope.users[thread.sendTo];
        title = user.status===USER_STATUS.offline?"(offline) ":"";
        title += user.name ;
        break;
      case THREAD_TYPE.multiuserThread:
        var participants = $scope.threads[threadId].users;
        if (!participants) return "Loading...";
        for (i = 0; i < participants.length; i++) {
          var userId = participants[i];
          if (($scope.users[userId] === undefined) || (userId === myId)) {
            continue;
          } else {
            title += title.length > 0 ? ", ": "";
            title += ($scope.users[userId].name|| "loading..." ).split(" ")[0];
          }
        }
        title = "({0}) ".f(participants.length) + title + " and me";
        break;
      case THREAD_TYPE.groupThread:
        title = "Group: " + $scope.groups[thread.sendTo].name;
        break;
      default:
        title = "Unknown";
      }
      return title;
    }
    $scope.closeThread = function(tid) {
      var index = $scope.openThreads.indexOf(tid);
      while (index !== - 1) {
        $scope.markThreadAsRead(tid);
        $scope.openThreads.splice(index, 1);
        index = $scope.openThreads.indexOf(tid);
      }
    }
    //toggle minimized thread
    $scope.toggleThread = function(threadId, show) {
      $scope.threads[threadId].minimized = ! ($scope.threads[threadId].minimized || false);
    }
    $scope.chatInputKeyDown = function(e, el) {
      $.event.fix(e);
      if (e.keyCode === 13) {
        $scope.sendMessage($(el).attr("threadid"));
      }
    }

    $scope.addFriendToThread = function(threadId, users) {
      if (users === null) return;
      if (typeof users === "number") users = [users];

      var thread = $scope.threads[threadId];
      if (thread.type === THREAD_TYPE.oneOneThread) {
        //send to server to init a multiuser thread with these users
        for (var i = 0; i < users.length; i++) {
          users[i] = parseInt(users[i]);
        }
        if ((typeof thread.sendTo === "number") && (users.indexOf(thread.sendTo) === - 1)) {
          users.push(thread.sendTo);
        } else {
          console.log("error: cannot add current user");
        }
        if (users.length === 1) return;

        var req = {
          requestType: REQUEST_TYPE.initiateMultiUserThread
        };
        req.users = users; // sender will be added to this thread by the server
        req.originalThread = threadId; //thread will be replaced when the server requests to open a multiuser thread
        iosocket.send(JSON.stringify(req));

      } else if (thread.type === THREAD_TYPE.multiuserThread) {
        //send to server to add more users to this thread
        for (var i = 0; i < users.length; i++) {
          users[i] = parseInt(users[i]);
        }
        var req = {
          requestType: REQUEST_TYPE.addFriendToMultiUserThread
        };
        req.users = users;
        req.threadId = thread.sendTo;
        iosocket.send(JSON.stringify(req));

      }
    }
    $scope.assignRosterEventListener = function(container, threadId) {
      var input = $($(container).find(".search-field")).find("input")[0];
      var btnAdd = $($(container).find("button.btnAddFriend"))[0];
      if (input) {
        $(input).keydown(function(e) {
          switch (e.keyCode) {
          case 13:
            //ENTER key
            if (e.ctrlKey) {
              var users = $(container).find("select").val();
              $scope.addFriendToThread(threadId, users);
              //reset and hide roster search box
              $(container).find("select").empty().trigger("liszt:updated");
              $scope.toggleRosterDropdown(threadId);
              $scope.$apply(function(){
                $scope.focusThread = threadId;
              })
            }
            break;
          case 27:
            //ESC key
            var overlay = $(container).find(".chat-roster-overlay");
            $(overlay).hide();

            $scope.$apply(function(){
              $scope.focusThread = threadId;
            })
            break;
          default:
          }
        });
      }
      if (btnAdd){
        $(btnAdd).click(function(e){
        
          var users = $(container).find("select").val();
          $scope.addFriendToThread(threadId, users);
          //reset and hide roster search box
          $(container).find("select").empty().trigger("liszt:updated");
          $scope.toggleRosterDropdown(threadId);
          $scope.$apply(function(){
            $scope.focusThread = threadId;
          })

        })
      
      }
    }

    //use case: get users for chosen drop down
    $scope.getFriendsNotInThread = function(tid) {
      var thread,users = $scope.friends.slice(0),groupId;
      if(thread = $scope.threads[tid]){
        var index;
        if((index = users.indexOf($scope.users[myId]))>=0){
          users.splice(index,1);
        };
        switch ($scope.getThreadTypeFromId(tid)) {
          case THREAD_TYPE.oneOneThread:
            users.splice(users.indexOf($scope.users[thread.sendTo]),1);
            break;
          case THREAD_TYPE.multiuserThread:
            $.each(thread.users || [],function(i,uid){

            if((index = users.indexOf($scope.users[uid]))>=0){
              users.splice(index,1);
            };
          })
            break;
          case THREAD_TYPE.groupThread:
            //this case is currently not used, as group thead doesnt allow adding more friends
            //might be used if this function is called in another place.
            break;
        }
        return users;
      }


    }
    $scope.toggleRosterDropdown = function(tid) {
      var threadId = tid;
      var container = $(".chat-dialog-container[threadid*='{0}']".f(escapeSelector(threadId)))
      if (container) {
        var overlay = $(container).find(".chat-roster-overlay");

        if ($(overlay).is(":visible")) {
          $(overlay).hide();
        } else {
          $(overlay).show();
          if ($(overlay).attr("isInitiated") === undefined) {
            $(".chzn-select2").chosen();
            fixChosenStyle(container);
            $scope.assignRosterEventListener(container, threadId);
            $(overlay).attr("isInitiated", "true");
          }
          $(container).find(".search-field").children("input")[0].focus();
        }
      }
    }

    $scope.leaveThread = function (tid) {
      var req = {
        requestType: REQUEST_TYPE.leaveMultiUserThread
      };
      req.threadId = $scope.threads[tid].sendTo;
      iosocket.send(JSON.stringify(req));
    }

    //fix Chosen multi select
    window.fixChosenStyle = function(container) {
      $(container).find('div.chzn-container').each(function() {
        $(this).css("width", "90%");
      });
      $(container).find('div.chzn-drop').each(function() {
        $(this).css("text-align", "left");
      });

    }

    /*return:
    userId for 1.1.thread
    groupId for group.thread
    threadId for multiuser.thread*/
    $scope.getThreadTypeFromId = function(threadId) {
      if (threadId.match("1\.1\.thread:[0-9]{1,}:[0-9]{1,}")) return THREAD_TYPE.oneOneThread;
      else if (threadId.match("group\.thread:[0-9]{1,}")) return THREAD_TYPE.groupThread;
      else if (threadId.match("multiuser\.thread:[0-9]{1,}")) return THREAD_TYPE.multiuserThread;
      else return - 1;
    };

    $scope.getThreadReceiver = function(threadId, threadType, myId) {
      threadType = (threadType===undefined)?$scope.getThreadTypeFromId(threadId):threadType;
      switch (threadType) {
        case THREAD_TYPE.oneOneThread:
          var user1Id = threadId.match(":[0-9]{1,}")[0];
        var user2Id = parseInt(threadId.replace(user1Id, "").match(":[0-9]{1,}")[0].replace(":", ""));
        user1Id = parseInt(user1Id.replace(":", ""));
        if (user1Id == myId) return user2Id;
        else return user1Id;
        break;
        case THREAD_TYPE.groupThread:
          var groupId = threadId.match(":[0-9]{1,}")[0].replace(":", "");
        return parseInt(groupId);
        break;

        case THREAD_TYPE.multiuserThread:
          var threadIdNum = threadId.match(":[0-9]{1,}")[0].replace(":", "");
        return parseInt(threadIdNum);
        break;

        default:
          console.trace("Error: unknown thread");
      }
      return null;
    }

    window.compareUserName = function(u1, u2) {
      if (u1.name.toLowerCase() < u2.name.toLowerCase()) return - 1;
      if (u1.name.toLowerCase() > u2.name.toLowerCase()) return 1;
      return 0;
    }

    window.compareNumber = function(a, b) {
      if ((typeof a === "number") && (typeof b === "number")) {
        return a - b;
      }else{
        throw new Error("One of the two arguments is not a number");
      }
    }

  },
  ]);
  //END OF CHAT CONTROLLER
});

(function($) {
  Drupal.behaviors.teamieChat = {
    attach: function(context, settings) {
      jQuery('body').once('chat-client', function() {
        // Run the chat client.
        chatClient($, angular, io);
      });
    }
  };
})(jQuery);