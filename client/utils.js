(function($) {
  
  window.escapeHTML = function(text) {
    //escape HTML in text first
    var pre = document.createElement('pre');
    var textNode = document.createTextNode(text);
    pre.appendChild(textNode);
    return pre.innerHTML;
  };
  
  window.linkify = function(text) {
    //linkify text
    if (text) {
      //escape
      text = text.replace(/((https?\:\/\/)|(www\.))(\S+)(\w{2,4})(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/gi, 
        function(url) {
          var full_url = url;
          if (!full_url.match('^https?:\/\/')) {
            full_url = 'http://' + full_url;
          }
          return '<a target="_blank"  href="' + full_url + '">' + url + '</a>';
        });
    }
    return text;
  };
  
  window.doubleEscapeSelector = function(str) {
    return str.replace(/[#;&,.+*~':"!^$[\]()=>|\/]/g, "\\\\$&");
  };
  
  window.escapeSelector = function(str) {
    return str.replace(/[#;&,.+*~':"!^$[\]()=>|\/]/g, "\\$&");
  };
  
  window.scrollToBottom = function(className) {
    $(".chat-dialog-content").each(function(i, div) {
      div.scrollTop = div.scrollHeight;
    });
  };

  String.prototype.format = 
  String.prototype.f = function() {
    var s = this,
    i = arguments.length;

    while (i--) {
      s = s.replace(new RegExp('\\{' + i + '\\}', 'gm'), arguments[i]);
    }
    return s;
  };

  window.isNumeric = function(n) {
    return ! isNaN(parseFloat(n)) && isFinite(n);
  };
  
  /* adapted from http://vaneyck.github.io/emoticonize/emot.js */
  var EMOTICON_ICONS = {
    ":)": "smile.png",
    ":-)": "smile.png",
    "=)": "smile.png",
    ":(": "sad.png",
    "=(": "sad.png",
    ":-(": "sad.png",
    ":D": "smile-big.png",
    ":-D": "smile-big.png",
    ":'(": "crying.png",
    ":p": "tongue.png",
    ":P": "tongue.png",
    ":-p": "tongue.png",
    ":-P": "tongue.png",
    ":o": "shock.png",
    "8-0": "shock.png",
    ":@": "angry.png",
    ":s": "confused.png",
    ":S": "confused.png",
    ";)": "wink.png",
    ";-)": "wink.png",
    ":|": "disapointed.png",
    "+o(": "sick.png",
    ":-#": "shut-mouth.png",
    "|-)": "sleepy.png",
    "8-)": "eyeroll.png",
    ":\\": "thinking.png",
    ":-\\": "thinking.png",
    "*-)": "thinking.png",
    ":--)": "lying.png",
    "8-|": "glasses-nerdy.png",
    "8o|": "teeth.png"
  };
  window.emoticonize = function(text, baseUrl) {
    if (!this.emotMap) {
      this.emotMap = (function(baseUrl) {
        var u = baseUrl + "/emoticons/";
        var m = EMOTICON_ICONS;
        var img;
        $.each(m, function(k, v) {
          m[k] = u + v;
        });
        return m;
      })(baseUrl);
    }
    $.each(emotMap, function(k, v) {
      text = text.replace(k, "<img class='emoticon-icon' src='" + emotMap[k] + "'/>");
    });
    return text;
  };

  // to move an element of old_index to new_index
	Array.prototype.move = function (old_index, new_index) {
			var self = this;
			// Ugly hack required because of an unknown issue with jQuery form plugin
			// because of which AJAX form ops on a page with this script file included
			// doesn't work!

			// Needs jQuery.
			if (jQuery.isArray(this)) {
					if (new_index >= self.length) {
							var k = new_index - self.length;
							while ((k--) + 1) {
									this.push(undefined);
							}
					}
					this.splice(new_index, 0, this.splice(old_index, 1)[0]);
					return self;
			}
	};

})(jQuery);