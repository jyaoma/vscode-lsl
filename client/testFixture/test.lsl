integer DEBUG_MODE = TRUE;

string MENU_ITEM_START = "Start Game";
string MENU_ITEM_END = "End Game";
string MENU_ITEM_HELP = "Help";
string MENU_ITEM_RULES = "Rules";
string MENU_ITEM_YAKU = "Yaku List";
string MENU_ITEM_DIAGNOSTICS = "Diagnostics";
string MENU_ITEM_DIAG_P1_HUD = "P1 HUD";
string MENU_ITEM_DIAG_P2_HUD = "P2 HUD";
string MENU_ITEM_DIAG_DEAL = "Deal";
string MENU_ITEM_DIAG_RESET = "Reset";

string NOTECARD_RULES = "Koi-Koi Rules";

list MENU_MAIN = [MENU_ITEM_START, MENU_ITEM_HELP];
list MENU_STARTED = [MENU_ITEM_END, MENU_ITEM_HELP];
list MENU_HELP = [MENU_ITEM_RULES, MENU_ITEM_YAKU];
list MENU_DIAGNOSTICS = [MENU_ITEM_DIAG_P1_HUD, MENU_ITEM_DIAG_P2_HUD, MENU_ITEM_DIAG_DEAL, MENU_ITEM_DIAG_RESET];

string LINK_NAME_PLAYER_1_SEAT = "player1seat";
integer linkPlayer1Seat = -1;
string LINK_NAME_PLAYER_2_SEAT = "player2seat";
integer linkPlayer2Seat = -1;
string LINK_NAME_PLAYER_1_DISPLAY = "player1display";
integer linkPlayer1Display = -1;
string LINK_NAME_PLAYER_2_DISPLAY = "player2display";
integer linkPlayer2Display = -1;

list CARD_MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
list CARD_NUMBERS = ["A", "B", "C", "D"];

key player1 = NULL_KEY;
key player1HUD = NULL_KEY;
list player1Hand = [];
list player1PointPile = [];
key player2 = NULL_KEY;
key player2HUD = NULL_KEY;
list player2Hand = [];
list player2PointPile = [];
list tableCards = [];

integer MESSAGE_RESET = 0;
integer MESSAGE_PLAYER_CHANGE = 1;
integer MESSAGE_GAME_START = 2;
integer MESSAGE_GAME_END = 3;
integer MESSAGE_DRAW_CARD = 4;

integer playerChannel = -965;
integer hudChannel = -966;
key menuToucher;
integer menuListener;
integer menuOpen;

float deckOffsetX = -0.8;

list deck = [];

shuffleDeck() {
    integer cardMonthIndex = 0;
    list orderedDeck = [];
    for (; cardMonthIndex < llGetListLength(CARD_MONTHS); cardMonthIndex++) {
        string cardMonth = llList2String(CARD_MONTHS, cardMonthIndex);
        integer cardNumberIndex = 0;
        for (; cardNumberIndex < llGetListLength(CARD_NUMBERS); cardNumberIndex++) {
            string cardNumber = llList2String(CARD_NUMBERS, cardNumberIndex);
            string cardId = cardMonth + cardNumber;
            orderedDeck = orderedDeck + [cardId];
        }
    }

    deck = [];
    while (llGetListLength(orderedDeck) > 0) {
        integer randomCardIndex = llFloor(llFrand(llGetListLength(orderedDeck)));
        string randomCard = llList2String(orderedDeck, randomCardIndex);
        deck = deck + [randomCard];
        orderedDeck = llListReplaceList(orderedDeck, [], randomCardIndex, randomCardIndex);
    }
}

sendPlayer1Cards() {
    if (player1HUD != NULL_KEY) llRegionSayTo(player1HUD, hudChannel, llList2CSV(player1Hand));
}

sendPlayer1PointPile() {
    // TODO
}

sendPlayer2Cards() {
    if (player2HUD != NULL_KEY) llRegionSayTo(player2HUD, hudChannel, llList2CSV(player2Hand));
}

sendPlayer2PointPile() {
    // TODO
}

renderTableCards() {
    // TODO
}

dealCards() {
    shuffleDeck();

    // decide oya
    string player1Card = llList2String(deck, 0);
    string player2Card = llList2String(deck, 1);
    string player1CardMonth = llGetSubString(player1Card, 0, 1);
    string player2CardMonth = llGetSubString(player2Card, 0, 1);
    integer player1CardMonthIndex = llListFindList(CARD_MONTHS, [player1CardMonth]);
    integer player2CardMonthIndex = llListFindList(CARD_MONTHS, [player2CardMonth]);
    integer isPlayer1Oya = -1;
    if (player1CardMonthIndex > player2CardMonthIndex) {
        isPlayer1Oya = TRUE;
    } else if (player2CardMonthIndex > player1CardMonthIndex) {
        isPlayer1Oya = FALSE;
    } else {
        string player1CardNumber = llGetSubString(player1Card, 2, 2);
        string player2CardNumber = llGetSubString(player2Card, 2, 2);
        integer player1CardNumberIndex = llListFindList(CARD_NUMBERS, [player1CardNumber]);
        integer player2CardNumberIndex = llListFindList(CARD_NUMBERS, [player2CardNumber]);
        isPlayer1Oya = player1CardNumberIndex >= player2CardNumberIndex;
    }

    // Deal cards, sending cards to players
    integer dealIndex = 0;
    for (; dealIndex < 4; dealIndex++) {
        string card1 = llList2String(deck, 0);
        string card2 = llList2String(deck, 1);
        deck = llListReplaceList(deck, [], 0, 1);
        if (isPlayer1Oya) {
            player1Hand = player1Hand + [card1, card2];
            sendPlayer1Cards();
        } else {
            player2Hand = player2Hand + [card1, card2];
            sendPlayer2Cards();
        }

        card1 = llList2String(deck, 0);
        card2 = llList2String(deck, 1);
        deck = llListReplaceList(deck, [], 0, 1);
        tableCards = tableCards + [card1, card2];
        
        card1 = llList2String(deck, 0);
        card2 = llList2String(deck, 1);
        deck = llListReplaceList(deck, [], 0, 1);
        if (isPlayer1Oya) {
            player2Hand = player2Hand + [card1, card2];
            sendPlayer2Cards();
        } else {
            player1Hand = player1Hand + [card1, card2];
            sendPlayer1Cards();
        }
    }
}

reset() {
    player1PointPile = [];
    sendPlayer1PointPile();
    player1Hand = [];
    sendPlayer1Cards();
    player1 = NULL_KEY;
    player1HUD = NULL_KEY;

    player2PointPile = [];
    sendPlayer2PointPile();
    player2Hand = [];
    sendPlayer2Cards();
    player2 = NULL_KEY;
    player2HUD = NULL_KEY;

    tableCards = [];
    renderTableCards();
    llMessageLinked(LINK_SET, MESSAGE_RESET, "", NULL_KEY);
}

//////////////////////
// Diagnostic functions
//////////////////////

diagSendPlayer1Cards() {
    if (player1HUD == NULL_KEY) {
        llInstantMessage(llGetOwner(), "Warning: Player 1 HUD not detected");
    }
    player1Hand = ["01A","01B","02C","03D","11A","11D","12B","12C"];
    sendPlayer1Cards();
    player1Hand = [];
}

diagSendPlayer2Cards() {
    if (player2HUD == NULL_KEY) {
        llInstantMessage(llGetOwner(), "Warning: Player 2 HUD not detected");
    }
    player2Hand = ["01A","01B","02C","03D","11A","11D","12B","12C"];
    sendPlayer2Cards();
    player2Hand = [];
}

diagDeal() {
    dealCards();
}

default
{
    state_entry()
    {
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

        llListen(hudChannel, "", NULL_KEY, "");
    }

    touch_start( integer num_detected )
    {
        menuToucher = llDetectedKey(0);
        menuListener = llListen(playerChannel, "", menuToucher, "");
        llDialog(menuToucher, "Koi-Koi Main Menu", MENU_MAIN, playerChannel);
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
            if (player1 != NULL_KEY) llSay(hudChannel, "sync");
            else if (player1HUD != NULL_KEY) llRegionSayTo(player1HUD, hudChannel, "sync-disconnect");
        } else if (sender_num == linkPlayer2Seat) {
            player2 = id;
            llMessageLinked(linkPlayer2Display, MESSAGE_PLAYER_CHANGE, "", player2);
            if (player2 != NULL_KEY) llSay(hudChannel, "sync");
            else if (player2HUD != NULL_KEY) llRegionSayTo(player2HUD, hudChannel, "sync-disconnect");
        }
    }

    listen( integer channel, string name, key id, string message )
    {
        if (channel == playerChannel) {
            if (message == MENU_ITEM_HELP) {
                list helpMenu = MENU_HELP;
                if (id == llGetOwner()) {
                    helpMenu += [MENU_ITEM_DIAGNOSTICS];
                }
                llDialog(id, "Help Menu", helpMenu, playerChannel);
            } else if (message == MENU_ITEM_DIAGNOSTICS) {
                llDialog(id, "Diagnostics Menu", MENU_DIAGNOSTICS, playerChannel);
            } else {
                if (message == MENU_ITEM_START) {
                    if (player1 == NULL_KEY || player2 == NULL_KEY) {
                        llWhisper(PUBLIC_CHANNEL, "Please make sure both players are sitting before starting the game.");
                    } else {
                        state deal;
                    }
                }
                else if (message == MENU_ITEM_DIAG_RESET) reset();
                else if (message == MENU_ITEM_RULES) llGiveInventory(id, NOTECARD_RULES);
                else if (message == MENU_ITEM_YAKU) llLoadURL(id, "Redirecting to Wikipedia", "https://en.wikipedia.org/wiki/Koi-Koi#Yaku_listing");
                else if (message == MENU_ITEM_DIAG_P1_HUD) diagSendPlayer1Cards();
                else if (message == MENU_ITEM_DIAG_P2_HUD) diagSendPlayer2Cards();
                else if (message == MENU_ITEM_DIAG_DEAL) diagDeal();
                llListenRemove(menuListener);
            }
        } else if (channel == hudChannel) {
            if (llGetSubString(message, 0, 13) == "sync-handshake") {
                key playerId = llGetSubString(message, 15, -1);
                if (player1 == playerId) {
                    player1HUD = id;
                    llRegionSayTo(player1HUD, hudChannel, "sync-confirm");
                }
                else if (player2 == playerId) {
                    player2HUD = id;
                    llRegionSayTo(player2HUD, hudChannel, "sync-confirm");
                }
            }
        }
    }
}

state deal {
    state_entry()
    {
        // rez deck
        vector position = llGetPos();
        llRezObject("deck", <position.x + deckOffsetX, position.y, position.z + 0.09>, ZERO_VECTOR, ZERO_ROTATION, 0);
        
        dealCards();

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
        llDialog(llDetectedKey(0), "Koi-Koi", MENU_STARTED, playerChannel);
    }

    listen( integer channel, string name, key id, string message )
    {
        if (message == MENU_ITEM_END) {
            llMessageLinked(LINK_SET, MESSAGE_GAME_END, "", NULL_KEY);
            state default;
        }
    }
}
