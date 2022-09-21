const express = require('express');
const app = express();
const PORT = process.env.PORT || 5000; // this is to push the code to Heroku or allow it to run locally at 3000 //
const bodyParser = require('body-parser');
const https = require('https');
const querystring = require('querystring');
const cookieParser = require('cookie-parser');

app.set('view engine', 'ejs');
app.use('/static', express.static('public'));
app.use(bodyParser.urlencoded({
	extended: true
  }));
app.use(bodyParser.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser());

// OAuth (start)

require('dotenv').config();
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
// Supports a list of scopes as a string delimited by ',' or ' ' or '%20'
const SCOPES = (process.env.SCOPE.split(/ |, ?|%20/) || ['contacts']).join(' ');

// const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`; //
const REDIRECT_URI = `https://ill-pink-magpie-garb.cyclic.app/oauth-callback`;

const refreshTokenStore = {};
const accessTokenCache = new NodeCache({ deleteOnExpire: true });

// Use a session to keep track of client ID
app.use(session({
  secret: Math.random().toString(36).substring(2),
  resave: true,
  saveUninitialized: true,
  cookie: {
  	maxAge: 12 * 30 * 24 * 60 * 60 * 1000
  }
}));

const authUrl =
  'https://app.hubspot.com/oauth/authorize' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` + // app's client ID
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`+ // where to send the user after the consent page
  `&scope=${encodeURIComponent(SCOPES)}` ; // scopes being requested by the app

// OAuth (end)

const MongoClient = require('mongodb').MongoClient;

const CONNECTION_URL = "mongodb+srv://joceyng:test@joceyng.hqak4.mongodb.net/test?retryWrites=true&w=majority";
const DATABASE_NAME = "joceyng"; // you can change the database name
var database, collection;

MongoClient.connect(CONNECTION_URL, { useNewUrlParser: true }, (error, client) => {
	if(error) throw error;
  
	database = client.db(DATABASE_NAME);
	collection = database.collection("newcollection");
});

app.get('/', (req, res) => {
    res.render('home', {title: "Home", name: req.body.name}); 
});

app.post('/', (req, res) => {
	res.render('home', {title: "Home", name: req.body.name});
});

app.get('/about', (req, res) => {
    res.render('about', {title: "About"}); 
});

app.get('/portfolio', (req, res) => {
    res.render('portfolio', {title: "Portfolio"}); 
});

app.get('/contact', (req, res) => {
    res.render('contact', {title: "Contact"}); 
});

app.get('/install', (req, res) => {
	console.log('Initiating OAuth 2.0 flow with HubSpot');
	console.log("Step 1: Redirecting user to HubSpot's OAuth 2.0 server");
	res.redirect(authUrl);
	console.log('Step 2: User is being prompted for consent by HubSpot');
  });

app.get('/oauth-callback', async (req, res) => {
    console.log('Step 3: Handling the request sent by the server');
  
	// Received a user authorization code, so now combine that with the other
	// required values and exchange both for an access token and a refresh token
	if (req.query.code) {
	  console.log('  > Received an authorization token');
  
	  const authCodeProof = {
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		redirect_uri: REDIRECT_URI,
		code: req.query.code
	  };
  
	  // Step 4
	  // Exchange the authorization code for an access token and refresh token
	  console.log('Step 4: Exchanging authorization code for an access token and refresh token');
	  const token = await exchangeForTokens(req.sessionID, authCodeProof);
	  if (token.message) {
		return res.redirect(`/error?msg=${token.message}`);
	  }
	  console.log(req.sessionID);
	  // Once the tokens have been retrieved, use them to make a query
	  // to the HubSpot API
	  res.redirect(`/admin`);
	}
});

// perform post request to get access and refresh tokens 
const exchangeForTokens = async (userId, exchangeProof) => {
	try {
	  const responseBody = await request.post('https://api.hubapi.com/oauth/v1/token', {
		form: exchangeProof
	  });
	  // Usually, this token data should be persisted in a database and associated with
	  // a user identity.
	  const tokens = JSON.parse(responseBody);
	  refreshTokenStore[userId] = tokens.refresh_token;
	  accessTokenCache.set(userId, tokens.access_token, Math.round(tokens.expires_in * 0.75));
  
	  console.log('  > Received an access token and refresh token');
	  return tokens.access_token;
	} catch (e) {
	  console.error(`  > Error exchanging ${exchangeProof.grant_type} for access token`);
	  return JSON.parse(e.response.body);
	}
};  

// store and pass required parameters for the token post request
const refreshAccessToken = async (userId) => {
	const refreshTokenProof = {
	  grant_type: 'refresh_token',
	  client_id: CLIENT_ID,
	  client_secret: CLIENT_SECRET,
	  redirect_uri: REDIRECT_URI,
	  refresh_token: refreshTokenStore[userId]
	};
	return await exchangeForTokens(userId, refreshTokenProof);
  };

// get access tokens stored in node cache module or initiate process to refresh access token  

const getAccessToken = async (userId) => {
	// If the access token has expired, retrieve
	// a new one using the refresh token
	if (!accessTokenCache.get(userId)) {
	  console.log('Refreshing expired access token');
	  await refreshAccessToken(userId);
	}
	return accessTokenCache.get(userId);
};
  
const isAuthorized = (userId) => {
	return refreshTokenStore[userId] ? true : false;
};

app.get('/admin', (req, res) => { 					  	
	if (isAuthorized(req.sessionID)) {
	 res.render('admin');
	} else {
	 res.render('adminInstall');
	}
   });

app.post('/admin', async (req, res) => {
	if (isAuthorized(req.sessionID)) {
		var searchInput = req.body.searchinput; // Store submitted form input into variable 
		var url = 'https://api.hubapi.com/contacts/v1/search/query?q=' + searchInput;

		const contactSearch = async (accessToken) => {
		try {
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
			};
			const data = await request.get(url, {headers: headers, json: true});
			return data;
		} catch (e) {
		return {msg: e.message}
		}};

		const accessToken = await getAccessToken(req.sessionID);
		const searchResults = await contactSearch(accessToken);
		var contactResults = JSON.stringify(searchResults.contacts);
		var parsedResults = JSON.parse(contactResults);

		res.render('searchresults', {contactsdata: parsedResults});
	} 
	else {
		res.redirect('/admin');
	}


});   

app.post('/', (req, res) => {

    var postData = querystring.stringify({
	    'firstname': req.body.firstname,
		'email': req.body.email,
		'message': req.body.message,
	    'hs_context': JSON.stringify({
	        "hutk": req.cookies.hubspotutk,
	        "ipAddress": req.headers['x-forwarded-for'] || req.connection.remoteAddress,
	        "pageUrl": "https://ill-pink-magpie-garb.cyclic.app/contact",
	        "pageName": "Contact me"
	    })
    });
    
    var options = {
		hostname: 'forms.hubspot.com',
		path: '/uploads/form/v2/4718896/4f836c1a-cc7f-4df6-92fd-52d2f34f3e8d',
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': postData.length
		}
    };
    var request = https.request(options, function(response){
		console.log("Status: " + response.statusCode);
		console.log("Headers: " + JSON.stringify(response.headers));
		response.setEncoding('utf8');
		response.on('data', function(chunk){
			console.log('Body: ' + chunk)
		});
	});

	request.on('error', function(e){
		console.log("Problem with request " + e.message)
	});

    request.write(postData);
	request.end();

    collection.insertOne(req.body, (err, result) => {  
        if (err) return console.log(err)
    
        console.log('saved to database')
        res.redirect('/') // or do something else here
      });
      
});

  // Start the application after the database connection is ready
  app.listen(PORT, () => {
	console.log('This app is running on port ' + PORT)
  });
