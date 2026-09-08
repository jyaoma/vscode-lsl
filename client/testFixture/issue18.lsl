default {
    state_entry()
    {
        llLinksetDataWrite("Alice, Bob," + " and Charlie", "At Home");
        llLinksetDataWrite("Alice, Bob, and Charlie", "At Home");
        llLinksetDataWrite("Alice, Bob, and Charlie" /* At Home,*/, "At Home");
    }
}