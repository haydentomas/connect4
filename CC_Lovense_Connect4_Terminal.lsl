// CC_Lovense_Connect4_Terminal.lsl
// Lovense-Integrated Connect Four Terminal
// Configures Media-on-a-Prim and manages player role registration.

string SERVER_URL = "https://connect4.alekzane.co.uk"; // Update with your Node.js server URL
integer MOAP_FACE = 2; // Face number where the screen is displayed

integer DIALOG_CHAN = -29874;
integer gListen = 0;
key gUser = NULL_KEY;
key gHttpReq = NULL_KEY;
string gPendingRole = "";

default {
    state_entry() {
        string gameId = (string)llGetKey();
        string boardUrl = SERVER_URL + "/board/" + gameId;
        
        // Setup Media on a Prim (MOAP)
        llClearPrimMedia(MOAP_FACE);
        llSetPrimMediaParams(MOAP_FACE, [
            PRIM_MEDIA_CURRENT_URL, boardUrl,
            PRIM_MEDIA_HOME_URL, boardUrl,
            PRIM_MEDIA_AUTO_PLAY, TRUE,
            PRIM_MEDIA_CONTROLS, PRIM_MEDIA_CONTROLS_MINI,
            PRIM_MEDIA_PERMS_INTERACT, PRIM_MEDIA_PERM_ANYONE,
            PRIM_MEDIA_PERMS_CONTROL, PRIM_MEDIA_PERM_ANYONE
        ]);
        
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("🔴 LOVENSE CONNECT 4 🟡\nTouch to join the game", <0.0, 0.9, 1.0>, 1.0);
        llOwnerSay("[Connect 4] Terminal initialized. Spectator URL: " + boardUrl);
    }

    touch_start(integer total_number) {
        key toucher = llDetectedKey(0);
        gUser = toucher;
        
        // Remove previous listener if any
        if (gListen) llListenRemove(gListen);
        
        gListen = llListen(DIALOG_CHAN, "", toucher, "");
        llSetTimerEvent(30.0); // 30s timeout for dialog
        
        llDialog(toucher, "Welcome to Lovense Connect Four!\nChoose your slot to register and open the controller on your phone/browser:", 
            ["Red Player", "Yellow Player", "Reset Game", "Cancel"], DIALOG_CHAN);
    }

    listen(integer channel, string name, key id, string message) {
        llSetTimerEvent(0.0);
        if (gListen) llListenRemove(gListen);
        gListen = 0;
        
        if (message == "Cancel") return;

        if (message == "Reset Game") {
            llSetText("🔴 LOVENSE CONNECT 4 🟡\nResetting board...", <1.0, 0.5, 0.0>, 1.0);
            
            // HTTP Request to reset the board on server
            gHttpReq = llHTTPRequest(SERVER_URL + "/api/reset", [
                HTTP_METHOD, "POST",
                HTTP_MIMETYPE, "application/x-www-form-urlencoded"
            ], "gameId=" + (string)llGetKey());
            
            llSetText("🔴 LOVENSE CONNECT 4 🟡\nTouch to join the game", <0.0, 0.9, 1.0>, 1.0);
            return;
        }

        string role = "";
        if (message == "Red Player") {
            role = "red";
        } else if (message == "Yellow Player") {
            role = "yellow";
        }

        if (role != "") {
            gPendingRole = role;
            string body = "gameId=" + (string)llGetKey() + 
                          "&uuid=" + (string)id + 
                          "&name=" + llEscapeURL(llKey2Name(id)) + 
                          "&role=" + role;
            
            // Join request to server
            gHttpReq = llHTTPRequest(SERVER_URL + "/api/join", [
                HTTP_METHOD, "POST",
                HTTP_MIMETYPE, "application/x-www-form-urlencoded"
            ], body);
        }
    }

    http_response(key request_id, integer status, list metadata, string body) {
        if (request_id != gHttpReq) return;
        gHttpReq = NULL_KEY;

        if (status != 200) {
            llRegionSayTo(gUser, 0, "⚠️ Connection Error: Server could not be reached. Ensure the server is running and the URL in the script description is correct.");
            return;
        }

        // Response contains success/error JSON
        // Simple search check for error text
        if (llSubStringIndex(body, "taken") != -1) {
            llRegionSayTo(gUser, 0, "❌ Error: The " + gPendingRole + " role is already taken by another player!");
        } else if (llSubStringIndex(body, "success\":true") != -1) {
            // Load play URL directly in viewer browser
            string playUrl = SERVER_URL + "/play/" + (string)llGetKey() + 
                             "?name=" + llEscapeURL(llKey2Name(gUser)) + 
                             "&uuid=" + (string)gUser;
            
            llLoadURL(gUser, "Open your Lovense Connect 4 Game Controller:", playUrl);
            llRegionSayTo(gUser, 0, "✅ Registered successfully! If the browser link did not pop up, click here to open: " + playUrl);
        }
    }

    timer() {
        llSetTimerEvent(0.0);
        if (gListen) llListenRemove(gListen);
        gListen = 0;
    }
}
