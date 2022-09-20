
const port = process.env.PORT || 3000;
const express = require('express');
const app = express();
app.get("/", function(req, res){
  res.render('home');
});
app.listen(port, function()
  {console.log("This app is running on port" + port);}
);
app.set("view engine","ejs");

