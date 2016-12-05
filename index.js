// would eventually like to store configurations in MongoDB
// and allow multiple accounts / management 

//var mongoose = require('mongoose');

var bodyParser = require('body-parser');
var logger = require('morgan');
var express = require('express');
var promise = require('promise');
var fs = require('fs');
var request = require('request');
var parse5 = require('parse5');

var walmartKey = "[walmart api key]";
var walmartApiUrl = "http://api.walmartlabs.com/v1/items/{productid}?apiKey={apiKey}&format=json";

var bestBuyKey = "[best buy api key - clue: BestBuy won't let you join their developer program using a free account... so use one for your own custom domain.]";
var bby = require('bestbuy')(bestBuyKey);

// Account
var twAcctSid = "[twilio account sid]";

// PRODUCTION
var twApiSid = "[twilio api sid]";
var twApiSecret = "[twilio api secret]";

var twilio = require('twilio')(twApiSid, twApiSecret);
var account = twilio.accounts(twAcctSid);

var app = express();

app.use(express.static('static'));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', function (req, res) {
    res.contentType = "application/json";
    res.statusCode = 204;
    res.send();
});

// SMS access whitelist
var allowedNumbers = [
    "+12125551212",
    "+13125551212"
];

var messageGoesTo;

// Other endpoints could support other calls where you can do more secure authorization. For example, an Alexa Skill.
app.post('/api/sms/priceupdates', function (req, res) {
    //if (req.get("Authorization")) {
    
    // Testing Basic Authorization - can get this working pretty easily. Don't like that Twilio uses user:pass@host:port methodology - would rather have it in the body.
    //console.log("Header found: " + req.get("Authorization"));

    // Need to address this - Twilio request validation didn't work, so am relying primarily on number whitelist, which could be easily spoofed.
    //var validTwilio = twilio.validateExpressRequest(req, twApiSecret);


    if (req.body && req.body.From) {

        // if (!validTwilio) {
        //     res.statusCode = 204;
        //     res.send();
        // }

        var isValidNumber = allowedNumbers.indexOf(req.body.From) > -1;
        if (!isValidNumber) {
            res.statusCode = 204;
            res.send();
        }

        messageGoesTo = req.body.From;

        readJSON('./trackedUrls.json').then(function (results) {
            if (results) {
                Promise.all(results.map(parsePrices));
            } else {
                Promise.reject(new Error('Unable to process JSON file: ' + err));
            }
        });
    } else {
        res.statusCode = 500;
        res.send("Unable to parse request body.");
    }
});

var port = process.env.PORT || 3000

var server = app.listen(port, function () {
    var host = server.address().address;
    var port = server.address().port;
    console.log("App listening at http://%s:%s", host, port);
});

function readJSON(filename) {
    return new Promise(function (fulfill, reject) {
        readFile(filename, 'utf8').then(function (res) {
            try {
                console.log("parsing file");
                var json = JSON.parse(res);
                fulfill(json);
            } catch (err) {
                //reject(err);
            }
        });
    });
}

function readFile(filename, encoding) {
    return new Promise(function (fulfill, reject) {
        try {
            console.log("reading file");
            fs.readFile(filename, encoding, function (err, result) {
                if (err) reject(err);
                else fulfill(result);
            });
        } catch (err) {
            reject(err);
        }
    });
}

function parsePrices(obj) {
    var newMessage = obj.name + "\n";
    constructMessage(obj).then(function (results) {
        results.forEach(function (value) {
            newMessage += value;
        });
        console.log(newMessage);
        sendMessage(newMessage);
    });
}

function constructMessage(obj) {
    return Promise.all(obj.urls.map(parseUrl));
}


// needs split up into multiple methods / external libraries
function parseUrl(value) {
    var msg = '';
    return new Promise(function (fulfill, reject) {
        if (value.toLowerCase().indexOf("target.com") > -1) {
            msg += "\nTarget: ";
            
            // TODO Get Item ID from product URL and pull JSON from web request.
            
            request({
                url: value,
                json: true
            }, function (error, response, body) {
                if (error) msg += "error";
                else if (response.statusCode == 200) {
                    msg += body.product.price.offerPrice.price;
                } else {
                    msg += "s" + response.statusCode;
                }
                fulfill(msg);
            });
        } else if (value.toLowerCase().indexOf("walmart.com") > -1) {
            msg += "\nWalmart: ";
            
            // TODO Get Item ID from product URL to make API call

            request({
                url: walmartApiUrl.replace("{apiKey}", walmartKey).replace("{productid}", "46645052"),
                json: true
            }, function (error, response, body) {
                if (error) msg += "error";
                else if (response.statusCode == 200) {
                    msg += body.salePrice || body.msrp;
                } else {
                    msg += "s" + response.statusCode;
                }
                fulfill(msg);
            });
        } else if (value.toLowerCase().indexOf("bestbuy.com") > -1) {
            msg += "\nBestBuy: ";

            // TODO Get Item ID from product URL to make API call

            bby.products(4448543, { show: 'salePrice' }).then(function (data) {
                if (data) {
                    msg += data.salePrice;
                } else {
                    msg += "error";
                }
                fulfill(msg);
            });
        } else if (value.toLowerCase().indexOf("newegg.com") > -1) {
            msg += "\nNewegg: ";

            // Have to do this one by scraping. No API available. Ouch.

            var found = false;
            try {
                request({
                    url: value,
                    json: false
                }, function (error, response, body) {
                    if (error) msg += "error";
                    else if (response.statusCode == 200) {
                        var doc = parse5.parse(body);
                        var metaElement = doc.childNodes[1].childNodes[2].childNodes[41].childNodes[5].childNodes[3].childNodes[1].childNodes[1];
                        metaElement.attrs.forEach(function (attr, index) {
                            if (attr.name == 'itemprop' && attr.value == 'price') {
                                msg += metaElement.attrs[index + 1].value;
                                found = true;
                                fulfill(msg);
                            }
                        });
                    } else {
                        msg += "s" + response.statusCode;
                        fulfill(msg);
                    }
                });
            } catch (ex){
                fulfill(ex);
            } finally {
                //fulfill(msg);
            }
        } else {
            msg += "No supported URLs found."
            fulfill(msg);
        }
    });
}

function sendMessage(message) {
    console.log("Message to send:");
    console.log(message);

    account.messages.create({
        to: messageGoesTo,
        from: "+[twilio number]",
        body: message
    }, function (err, message) {
        if (message) {
            console.log(message.sid);
        } else {
            console.log(err);
        }
    });
}