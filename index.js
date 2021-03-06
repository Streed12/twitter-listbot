// Required dependencies
const express = require('express');
const app = express();
const request = require('request');
const _ = require('lodash');
const fs = require('fs');
const gm = require('gm');

//Required modules local
const imgMods = require('./utilities/imgMods.js')
const imgFilter = require('./utilities/imgFilter.js');
const imgToBin = require('./utilities/imgToBin.js');

//Required setup
const { config, trackTerms } = require('./configExample.js')
const Twitter = require('twitter');
let twitter = new Twitter(config.keys);

app.get('/', function(req, res){ res.send('The robot is happily running.'); });
app.listen(process.env.PORT || 5000);

// Get the members of our list, and pass them into a callback function.
const getListMembers = (callback) => {
  let listMembers = new Map();
  listMembers.clear();
  let memberIDs = {
    blocked: [],
    following: []
  };

  tu.blocksList({owner_screen_name: config.me}, (error, data) => {
    data.users.forEach(bUser => memberIDs.blocked.push(bUser.id_str))
  })

  tu.listMembers({owner_screen_name: config.me,
    slug: config.list,
    count: 500
  }, (error, data) => {
    if (!error) {
      for (let i = 0; i < data.users.length; i++) {
        let { id_str, screen_name } = data.users[i];
        listMembers.set(id_str, screen_name);
        memberIDs.following.push(id_str);
      }
      // This callback is designed to run listen(memberIDs and listMembers).
      callback(memberIDs, listMembers);
    } else {
      console.log(error);
    }
  });
}


// What to do after we retweet something.
const onReTweet = (err) => {
  if(err) {
      console.error("retweeting failed :(");
      console.error(err);
  } else {
      console.log('success retweet')
  }
}
// What to do after we favorite something.
const doFavorite = (err) => {
  if(err) {
      console.error("Favorite failed :(", err);
  }
   else {
      console.log('success')
  }
}

// What to do when we get a tweet.
const onTweet = async (tweet, blocked, listMembers) => {
  // Destructure the tweet info we want
  const { id_str, user, text } = tweet;

  // Destructure the tweet properties we want to check as filters
  const { in_reply_to_status_id: inReply, in_reply_to_user_id: replyUser, retweeted, filter_level, lang } = tweet;
  
  // Reject the tweet if:
  //  1. it's flagged as a retweet
  //  2. it matches our regex rejection criteria
  //  3. it doesn't match our regex acceptance filter
  let regexReject = new RegExp(config.regexReject, 'i');
  let regexFilter = new RegExp(config.regexFilter, 'i');
  
  // Ignores tweets from blocked users on account
  if(blocked.includes(user.id_str) || user.screen_name === config.me){
    return;
  }
  if (retweeted || inReply || replyUser || lang !== 'en' || filter_level !== 'low') {
      return;
  }
  if (config.regexReject !== '' && regexReject.test(text)) {
      return;
  }

  if(tweet.entities.media && !regexReject.test(text)){
    let { media_url, type, id } = tweet.entities.media[0]
    if(type === 'photo') {
      try {
        let { status, type, message, info } = await imgFilter(media_url);
        if(status === 'success') {
          let imgData = await imgToBin(media_url);

          twitter.post('media/upload', {media_data: imgData}, (error, media, response) => {
            if(error) console.log('ERROR', error)
            else {
              let { media_id_string } = media;

              tu.updateStatus({
                status: `Nice fish @${user.screen_name}!`,
                media_ids: media_id_string
              }, (err, tweet, response) => {
                if(err) console.log('Error:', err)
                else console.log('Status Updated')
              }) 
            }
          })
        } else {
          if(type === 'safety' && (info.adult === 'LIKELY' || info.violence === 'LIKELY')){
            tu.createBlock({
              user_id: user.is_str
            }) 
          }
        }
      } catch(e) {
        console.log(e)
      }
    }
  }
  if(listMembers.has(user.id_str)){
    tu.retweet({
      id: id_str
    }, onReTweet)
    
  } else {
    tu.createFavorite({
      id: id_str
    }, doFavorite);
    
    // If we wanted to add friends / follow users when we liked the tweet. 
    tu.createFriendship({
      id: user.id_str,
      follow: true
    }, doFavorite)
  }   
}

// Function for listening to twitter streams and retweeting on demand.
const listen = (memberIDs, listMembers) => {
  let { blocked, following } = memberIDs
  tu.filter({
    follow: following,
    track: trackTerms
  }, function(stream) {
      console.log("listening to stream")
      stream.on('tweet', (tweet) => {
          onTweet(tweet, blocked, listMembers)
      });
  });
}

// The application itself.
// Use the tuiter node module to get access to twitter.
let tu = require('tuiter')(config.keys);

// Run the application. The callback in getListMembers ensures we get our list
// of twitter streams before we attempt to listen to them via the twitter API.
getListMembers(listen);
