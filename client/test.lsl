integer DEBUG_MODE = TRUE;

string MENU_ITEM_RESET = "Reset";
string MENU_ITEM_START = "Start Game";
string MENU_ITEM_END = "End Game";

list MAIN_MENU = [MENU_ITEM_START, MENU_ITEM_RESET];
list STARTED_MENU = [MENU_ITEM_END];

string LINK_NAME_PLAYER_1_SEAT = "player1seat";
integer linkPlayer1Seat = -1;
string LINK_NAME_PLAYER_2_SEAT = "player2seat";
integer linkPlayer2Seat = -1;
string LINK_NAME_PLAYER_1_DISPLAY = "player1display";
integer linkPlayer1Display = -1;
string LINK_NAME_PLAYER_2_DISPLAY = "player2display";
integer linkPlayer2Display = -1;

key player1 = NULL_KEY;
key player2 = NULL_KEY;

integer MESSAGE_RESET = 0;
integer MESSAGE_PLAYER_CHANGE = 1;
integer MESSAGE_GAME_START = 2;
integer MESSAGE_GAME_END = 3;
integer MESSAGE_DRAW_CARD = 4;

integer playerChannel = -965;
key menuToucher;
integer menuListener;
integer menuOpen;

float deckOffsetX = -0.8;

test() {
    vector position = llGetPos();
    llRezObject("deck", <position.x + deckOffsetX, position.y, position.z + 0.09>, ZERO_VECTOR, ZERO_ROTATION, 0);
}

default
{
    state_entry()
    {
        llAdjustDamage();
        llS
        llRezObject(string inventory, vector pos, vector vel, rotation rot, integer param);
        menuToucher = NULL_KEY;
        menuOpen = FALSE;

        player1 = NULL_KEY;
        player2 = NULL_KEY;
        integer numberOfLinks = llGetNumberOfPrims();
        integer i;
        for (i = 0; i <= numberOfLinks; i++) {
            string linkName = llGetLinkName(i);
            if (linkName == LINK_NAME_PLAYER_1_SEAT) linkPlayer1Seat = i;
            else if (linkName == LINK_NAME_PLAYER_2_SEAT) linkPlayer2Seat = i;
            else if (linkName == LINK_NAME_PLAYER_1_DISPLAY) linkPlayer1Display = i;
            else if (linkName == LINK_NAME_PLAYER_2_DISPLAY) linkPlayer2Display = i;
        }

        if (DEBUG_MODE) {
            llListen(0, "", llGetOwner(), "");
        }
    }

    touch_start( integer num_detected )
    {
        menuToucher = llDetectedKey(0);
        menuListener = llListen(playerChannel, "", menuToucher, "");
        llDialog(menuToucher, "Koi-Koi Main Menu", MAIN_MENU, playerChannel);
        menuOpen = TRUE;
        llSetTimerEvent(60);
    }

    timer()
    {
        if (menuOpen) {
            menuToucher = NULL_KEY;
            
            llListenRemove(menuListener);
            
        }
    }

    link_message( integer sender_num, integer num, string str, key id )
    {
        if (sender_num == linkPlayer1Seat) {
            player1 = id;
            llMessageLinked(linkPlayer1Display, MESSAGE_PLAYER_CHANGE, "", player1);
        } else if (sender_num == linkPlayer2Seat) {
            player2 = id;
            llMessageLinked(linkPlayer2Display, MESSAGE_PLAYER_CHANGE, "", player2);
        }
    }

    listen( integer channel, string name, key id, string message )
    {
        if (message == MENU_ITEM_RESET) {
            llMessageLinked(LINK_SET, MESSAGE_RESET, "", NULL_KEY);
        } else if (message == MENU_ITEM_START) {
            if (player1 == NULL_KEY || player2 == NULL_KEY) {
                llWhisper(PUBLIC_CHANNEL, "Please make sure both players are sitting before starting the game.");
            } else {
                state deal;
            }
        }
        
        if (id == llGetOwner()) {
            if (message == "test") test();
            else if (message == "reset") llMessageLinked(LINK_ALL_OTHERS, MESSAGE_RESET, "", "");
        }
    }
}

state deal {
    state_entry()
    {
        test();
        // TODO: Render the deck (thick card)
        // TODO: Generate a deck state (shuffle the cards and remember order)
        // TODO: Each player draws a card
        // TODO: Compare the card values and pick the oya
        // TODO: Deal cards, sending cards to players
        // TODO: Start the game?
        state started;
    }
}

state started {
    state_entry()
    {
        llMessageLinked(LINK_SET, MESSAGE_GAME_START, "", NULL_KEY);
    }

    touch_start( integer num_detected )
    {
        llListen(playerChannel, "", NULL_KEY, "");
        llDialog(llDetectedKey(0), "Koi-Koi", STARTED_MENU, playerChannel);
    }

    listen( integer channel, string name, key id, string message )
    {
        if (message == MENU_ITEM_END) {
            llMessageLinked(LINK_SET, MESSAGE_GAME_END, "", NULL_KEY);
            state default;
        }
    }
}