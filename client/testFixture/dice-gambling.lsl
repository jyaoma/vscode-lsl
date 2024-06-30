integer fullScore;
integer tempScore;

integer roll_dice() {
    return llCeil(llFrand(6));
}

default
{
    state_entry()
    {
        fullScore = 0;
        llListen(0, "", NULL_KEY, "");
    }

    listen(integer channel, string name, key id, string message)
    {
        if (message == "roll") {
            integer newRoll = roll_dice();
            if (newRoll == 1) {
                tempScore = 0;
                llSay(PUBLIC_CHANNEL, "You rolled a 1.\nOh no! You lost your temp points.");
            } else {
                tempScore += newRoll;
                llSay(PUBLIC_CHANNEL, "You rolled a " + (string)newRoll + ". Your temporary score is now " + (string)tempScore);
            }
        } else if (message == "save") {
            fullScore += tempScore;
            tempScore = 0;
            if (fullScore > 100) {
                llSay(PUBLIC_CHANNEL, "Your score is now " + (string)fullScore + ". You won!");
            } else {
                llSay(PUBLIC_CHANNEL, "Your score is now " + (string)fullScore + ".");
            }
        }
    }
}
