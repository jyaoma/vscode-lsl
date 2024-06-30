integer isShowing = FALSE;

default
{
    state_entry()
    {
        llSetText("", ZERO_VECTOR, 0);
        llSensorRepeat("", NULL_KEY, AGENT, 3, PI, 0.5);
    }

    sensor(integer num_detected)
    {
        if (!isShowing) {
            isShowing = TRUE;
            llSetTimerEvent(3);
        }
    }

    no_sensor()
    {
        isShowing = FALSE;
        llSetText("", ZERO_VECTOR, 0);
    }

    timer()
    {
        llSetTimerEvent(0);
        if (isShowing) {
            llSetText("Sample text", <1, 1, 1>, 1);
        }
    }
}
